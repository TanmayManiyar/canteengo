'use strict';
// MongoDB store (SRS 2.5: MongoDB is the sole system of record). Documents use string _id.
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const toDoc = (d) => {
  if (!d) return null;
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
};
const mapFilter = (f = {}) => {
  const { id, ...rest } = f;
  return id === undefined ? rest : { _id: id, ...rest };
};

async function createMongoStore(uri, dbName) {
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(dbName);

  // Unique idempotency key per checkout attempt (REQ-18).
  await db.collection('payments').createIndex({ idempotencyKey: 1 }, { unique: true });
  await db.collection('users').createIndex({ uid: 1 }, { unique: true });
  await db.collection('orders').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('orders').createIndex({ token: 1 }, { unique: true });

  function col(name) {
    const c = db.collection(name);
    return {
      async insert(doc) {
        const { id: given, ...rest } = doc;
        const id = given || crypto.randomUUID();
        await c.insertOne({ _id: id, ...rest });
        return { id, ...rest };
      },
      get: async (id) => toDoc(await c.findOne({ _id: id })),
      findOne: async (f) => toDoc(await c.findOne(mapFilter(f))),
      find: async (f) => (await c.find(mapFilter(f)).toArray()).map(toDoc),
      update: async (id, patch, cond) =>
        toDoc(await c.findOneAndUpdate({ _id: id, ...cond }, { $set: patch }, { returnDocument: 'after' })),
      inc: async (id, fields) =>
        toDoc(await c.findOneAndUpdate({ _id: id }, { $inc: fields }, { returnDocument: 'after' })),
      remove: async (id) => (await c.deleteOne({ _id: id })).deletedCount > 0,
    };
  }

  return {
    col,
    async reserveSlot(id) {
      const d = await db
        .collection('slots')
        .findOneAndUpdate(
          { _id: id, $expr: { $lt: ['$reserved', '$capacity'] } },
          { $inc: { reserved: 1 } },
          { returnDocument: 'after' }
        );
      return toDoc(d);
    },
    async releaseSlot(id) {
      await db.collection('slots').updateOne({ _id: id, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } });
    },
    close: () => client.close(),
  };
}

module.exports = { createMongoStore };
