import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';

/**
 * Never a blank screen: a page that fails to draw says so. A missing piece of
 * the app (OKB was rebuilt or updated while the page was open) asks for a reload.
 */
export class Boundary extends Component<{ children: ReactNode; labels: { title: string; updated: string; reload: string } }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);
    return (
      <div className="page">
        <div className="notice err" role="alert">
          <div className="stack" style={{ gap: 6 }}>
            <strong>{stale ? this.props.labels.updated : this.props.labels.title}</strong>
            {stale ? null : <span>{error.message}</span>}
            <span><button type="button" className="btn sm" onClick={() => window.location.reload()}><RotateCw size={14} aria-hidden="true" />{this.props.labels.reload}</button></span>
          </div>
        </div>
      </div>
    );
  }
}
