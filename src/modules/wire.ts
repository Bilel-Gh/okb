import { registerProjectSource } from '../projects/sources.js';
import { devProjects } from '../work/projects.js';

/**
 * Where the modules meet the core (F2.0-25): each module registers what it
 * brings to the core's objects. The core never imports a module; it asks the
 * registries, and this file is the only one that knows every module.
 */
registerProjectSource('dev', devProjects);
