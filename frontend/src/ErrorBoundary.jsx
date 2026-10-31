import { Component } from 'react';

// Shows a message instead of a blank page if a screen crashes.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('Screen crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">😕</div>
        <h2>Something went wrong</h2>
        <p className="muted">Please reload the page. Your cart is saved.</p>
        <button className="primary" onClick={() => window.location.assign('/')}>Reload</button>
      </div>
    );
  }
}
