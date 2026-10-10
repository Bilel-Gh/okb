import { z } from 'zod';
import { createProject, getProject, listProjects, updateProject } from '../../projects/projects.js';
import { syncProjects } from '../../projects/sources.js';
import { defineOperation } from '../operation.js';

const line = (max: number) => z.string().trim().max(max);
const id = z.string().regex(/^P-[a-z0-9]{6}$/).describe('A project id, as returned by projects.list.');

export const projectsList = defineOperation({
  id: 'projects.list',
  module: 'core',
  effect: 'read',
  summary: 'The person’s projects (subjects, and with the developer module tickets and repositories), each with where it stands in one sentence and its next step.',
  input: z.object({
    status: z.enum(['open', 'active', 'waiting', 'done', 'all']).default('open').describe('open = active and waiting.'),
    kind: z.string().max(40).optional(),
  }).strict(),
  async run({ config, env }, input) {
    await syncProjects(config, env);
    return { projects: await listProjects(config, env, input) };
  },
});

export const projectsGet = defineOperation({
  id: 'projects.get',
  module: 'core',
  effect: 'read',
  summary: 'One project by its id: where it stands, its next step, and where the person left off.',
  input: z.object({ id }).strict(),
  async run({ config }, input) {
    return { project: getProject(config, input.id) };
  },
});

export const projectsCreate = defineOperation({
  id: 'projects.create',
  module: 'core',
  effect: 'state',
  summary: 'Create a project for a subject the person works on (a course, a mission, an event). Tickets and repositories become projects by themselves.',
  input: z.object({
    title: z.string().trim().min(1).max(200),
    where: line(400).optional().describe('Where it stands, in one sentence.'),
    next: line(300).optional().describe('The next step.'),
    folder: z.string().max(300).optional().describe('The folder of the knowledge base that holds its notes.'),
  }).strict(),
  async run({ config }, input) {
    return createProject(config, input);
  },
});

export const projectsUpdate = defineOperation({
  id: 'projects.update',
  module: 'core',
  effect: 'state',
  summary: 'Change a project: its title, where it stands, its next step, or its status (active, waiting, done).',
  input: z.object({
    id,
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['active', 'waiting', 'done']).optional(),
    where: line(400).optional(),
    next: line(300).optional(),
  }).strict(),
  async run({ config }, input) {
    const { id: projectId, ...patch } = input;
    return updateProject(config, projectId, patch);
  },
});
