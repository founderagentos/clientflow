import type { RouteDescriptor } from '@agentos/contracts';
import { listQuerySchema, versionBodySchema } from './crm-http';
import { createAccountBodySchema, linkContactBodySchema, updateAccountBodySchema } from './accounts.dto';
import { createContactBodySchema, updateContactBodySchema } from './contacts.dto';
import {
  assignDealBodySchema,
  closeDealBodySchema,
  createDealBodySchema,
  transitionDealBodySchema,
  updateDealBodySchema,
} from './deals.dto';
import {
  addStageBodySchema,
  createPipelineBodySchema,
  reorderStagesBodySchema,
  updatePipelineBodySchema,
  updateStageBodySchema,
} from './pipelines.dto';
import {
  assignLeadBodySchema,
  createLeadBodySchema,
  mergeLeadBodySchema,
  statusChangeBodySchema,
  updateLeadBodySchema,
} from './leads.dto';
import { importCsvSchema } from './imports.dto';

/**
 * OpenAPI 3.1 descriptors for the CRM HTTP surface (RFC-002 §7), reusing each route's Zod DTO so the
 * document never drifts from validation (CLAUDE.md §6). A coverage test asserts this list matches the
 * live Nest routes exactly. Paths use Nest's `:param` form; the global prefix is included.
 */

const accountRoutes: RouteDescriptor[] = [
  { method: 'get', path: '/api/v1/accounts', summary: 'List accounts (keyset-paginated)', tags: ['Accounts'], permission: 'account.read', query: listQuerySchema, response: { status: 200, description: 'Accounts page' } },
  { method: 'post', path: '/api/v1/accounts', summary: 'Create an account', tags: ['Accounts'], permission: 'account.create', body: createAccountBodySchema, response: { status: 201, description: 'Created account' } },
  { method: 'get', path: '/api/v1/accounts/:id', summary: 'Read an account', tags: ['Accounts'], permission: 'account.read', response: { status: 200, description: 'The account' } },
  { method: 'patch', path: '/api/v1/accounts/:id', summary: 'Update an account', tags: ['Accounts'], permission: 'account.update', body: updateAccountBodySchema, response: { status: 200, description: 'Updated account' } },
  { method: 'delete', path: '/api/v1/accounts/:id', summary: 'Archive an account (blocked while open deals exist)', tags: ['Accounts'], permission: 'account.delete', body: versionBodySchema, response: { status: 204, description: 'Archived' } },
  { method: 'get', path: '/api/v1/accounts/:id/contacts', summary: 'List the contacts linked to an account', tags: ['Accounts'], permission: 'account.read', response: { status: 200, description: 'Linked contacts' } },
  { method: 'post', path: '/api/v1/accounts/:id/contacts', summary: 'Link a contact to an account', tags: ['Accounts'], permission: 'account.update', body: linkContactBodySchema, response: { status: 201, description: 'Linked' } },
  { method: 'patch', path: '/api/v1/accounts/:id/contacts/:contactId', summary: 'Set a linked contact as the account primary', tags: ['Accounts'], permission: 'account.update', response: { status: 200, description: 'Primary set' } },
  { method: 'delete', path: '/api/v1/accounts/:id/contacts/:contactId', summary: 'Unlink a contact from an account', tags: ['Accounts'], permission: 'account.update', response: { status: 204, description: 'Unlinked' } },
];

const contactRoutes: RouteDescriptor[] = [
  { method: 'get', path: '/api/v1/contacts', summary: 'List contacts (keyset-paginated)', tags: ['Contacts'], permission: 'contact.read', query: listQuerySchema, response: { status: 200, description: 'Contacts page' } },
  { method: 'post', path: '/api/v1/contacts', summary: 'Create a contact', tags: ['Contacts'], permission: 'contact.create', body: createContactBodySchema, response: { status: 201, description: 'Created contact' } },
  { method: 'get', path: '/api/v1/contacts/:id', summary: 'Read a contact', tags: ['Contacts'], permission: 'contact.read', response: { status: 200, description: 'The contact' } },
  { method: 'patch', path: '/api/v1/contacts/:id', summary: 'Update a contact', tags: ['Contacts'], permission: 'contact.update', body: updateContactBodySchema, response: { status: 200, description: 'Updated contact' } },
  { method: 'delete', path: '/api/v1/contacts/:id', summary: 'Archive a contact', tags: ['Contacts'], permission: 'contact.delete', body: versionBodySchema, response: { status: 204, description: 'Archived' } },
  { method: 'post', path: '/api/v1/contacts/:id/erasure', summary: 'Erase a contact PII (GDPR/DPDP, sensitive)', tags: ['Contacts'], permission: 'contact.erase', body: versionBodySchema, response: { status: 204, description: 'Erased (tombstone left)' } },
];

const dealRoutes: RouteDescriptor[] = [
  { method: 'get', path: '/api/v1/deals', summary: 'List deals (keyset-paginated)', tags: ['Deals'], permission: 'deal.read', query: listQuerySchema, response: { status: 200, description: 'Deals page' } },
  { method: 'post', path: '/api/v1/deals', summary: 'Create a deal', tags: ['Deals'], permission: 'deal.create', body: createDealBodySchema, response: { status: 201, description: 'Created deal' } },
  { method: 'get', path: '/api/v1/deals/:id', summary: 'Read a deal', tags: ['Deals'], permission: 'deal.read', response: { status: 200, description: 'The deal' } },
  { method: 'patch', path: '/api/v1/deals/:id', summary: 'Update a deal', tags: ['Deals'], permission: 'deal.update', body: updateDealBodySchema, response: { status: 200, description: 'Updated deal' } },
  { method: 'delete', path: '/api/v1/deals/:id', summary: 'Archive a deal', tags: ['Deals'], permission: 'deal.delete', body: versionBodySchema, response: { status: 204, description: 'Archived' } },
  { method: 'post', path: '/api/v1/deals/:id/assignment', summary: 'Assign a deal owner', tags: ['Deals'], permission: 'deal.assign', body: assignDealBodySchema, response: { status: 200, description: 'Assigned deal' } },
  { method: 'post', path: '/api/v1/deals/:id/stage-transitions', summary: 'Move a deal to another stage (guarded)', tags: ['Deals'], permission: 'deal.transition', body: transitionDealBodySchema, response: { status: 200, description: 'Transitioned deal' } },
  { method: 'post', path: '/api/v1/deals/:id/closure', summary: 'Close a deal won/lost', tags: ['Deals'], permission: 'deal.close', body: closeDealBodySchema, response: { status: 200, description: 'Closed deal' } },
];

const pipelineRoutes: RouteDescriptor[] = [
  { method: 'get', path: '/api/v1/pipelines', summary: 'List pipelines', tags: ['Pipelines'], permission: 'pipeline.read', response: { status: 200, description: 'Pipelines' } },
  { method: 'post', path: '/api/v1/pipelines', summary: 'Create a pipeline', tags: ['Pipelines'], permission: 'pipeline.manage', body: createPipelineBodySchema, response: { status: 201, description: 'Created pipeline' } },
  { method: 'patch', path: '/api/v1/pipelines/:id', summary: 'Update a pipeline', tags: ['Pipelines'], permission: 'pipeline.manage', body: updatePipelineBodySchema, response: { status: 200, description: 'Updated pipeline' } },
  { method: 'get', path: '/api/v1/pipelines/:id/board', summary: 'Read the pipeline board (deal counts + amount sums per stage)', tags: ['Pipelines'], permission: 'pipeline.read', response: { status: 200, description: 'Board' } },
  { method: 'post', path: '/api/v1/pipelines/:id/stages', summary: 'Add a stage to a pipeline', tags: ['Pipelines'], permission: 'pipeline.manage', body: addStageBodySchema, response: { status: 201, description: 'Created stage' } },
  { method: 'patch', path: '/api/v1/pipelines/:id/stages/:stageId', summary: 'Update a pipeline stage', tags: ['Pipelines'], permission: 'pipeline.manage', body: updateStageBodySchema, response: { status: 200, description: 'Updated stage' } },
  { method: 'put', path: '/api/v1/pipelines/:id/stages', summary: 'Reorder a pipeline stages', tags: ['Pipelines'], permission: 'pipeline.manage', body: reorderStagesBodySchema, response: { status: 204, description: 'Reordered' } },
];

const leadRoutes: RouteDescriptor[] = [
  { method: 'get', path: '/api/v1/leads', summary: 'List leads (keyset-paginated)', tags: ['Leads'], permission: 'lead.read', query: listQuerySchema, response: { status: 200, description: 'Leads page' } },
  { method: 'post', path: '/api/v1/leads', summary: 'Create a lead', tags: ['Leads'], permission: 'lead.create', body: createLeadBodySchema, response: { status: 201, description: 'Created lead' } },
  { method: 'get', path: '/api/v1/leads/:id', summary: 'Read a lead', tags: ['Leads'], permission: 'lead.read', response: { status: 200, description: 'The lead' } },
  { method: 'patch', path: '/api/v1/leads/:id', summary: 'Update a lead', tags: ['Leads'], permission: 'lead.update', body: updateLeadBodySchema, response: { status: 200, description: 'Updated lead' } },
  { method: 'post', path: '/api/v1/leads/:id/assignment', summary: 'Assign a lead owner', tags: ['Leads'], permission: 'lead.assign', body: assignLeadBodySchema, response: { status: 200, description: 'Assigned lead' } },
  { method: 'post', path: '/api/v1/leads/:id/status-changes', summary: 'Change a lead status', tags: ['Leads'], permission: 'lead.update', body: statusChangeBodySchema, response: { status: 200, description: 'Updated lead' } },
  { method: 'post', path: '/api/v1/leads/:id/merges', summary: 'Merge another lead into this survivor', tags: ['Leads'], permission: 'lead.merge', body: mergeLeadBodySchema, response: { status: 204, description: 'Merged' } },
  { method: 'post', path: '/api/v1/leads/:id/conversion', summary: 'Convert a lead to Account+Contact+Deal (one-shot)', tags: ['Leads'], permission: 'lead.convert', response: { status: 201, description: 'Converted (produced ids returned)' } },
];

const importRoutes: RouteDescriptor[] = [
  { method: 'post', path: '/api/v1/imports', summary: 'Submit a bulk lead CSV import (text/csv body + Idempotency-Key)', tags: ['Imports'], permission: 'lead.import', body: importCsvSchema, response: { status: 202, description: 'Import job accepted' } },
  { method: 'get', path: '/api/v1/imports/:id', summary: 'Read a bulk import job status + counts', tags: ['Imports'], permission: 'lead.read', response: { status: 200, description: 'Import job' } },
];

/** The full CRM HTTP route registry, in a stable order, for the OpenAPI document. */
export const crmRouteDescriptors: RouteDescriptor[] = [
  ...accountRoutes,
  ...contactRoutes,
  ...dealRoutes,
  ...pipelineRoutes,
  ...leadRoutes,
  ...importRoutes,
];
