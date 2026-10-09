import type { Translate } from '../app/i18n';
import { FirstChoice } from './Brains';

/** No brain on this computer yet: the guided setup, full page. */
export default function FirstRun(_props: { t: Translate }) {
  return <div className="first-run"><div className="panel first-run-card"><div className="panel-body"><FirstChoice /></div></div></div>;
}
