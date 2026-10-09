import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/brain.css';
import './styles/graph.css';
import './styles/okb.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
