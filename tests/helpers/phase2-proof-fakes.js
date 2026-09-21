import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

function copyTask(task) {
  return {
    ...structuredClone(task),
    httpRequest: {
      ...structuredClone(task.httpRequest),
      body: Buffer.from(task.httpRequest.body),
    },
  };
}

export class FakeCloudTasksClient {
  constructor() {
    this.tasks = new Map();
    this.createAttempts = 0;
    this.lookups = 0;
  }

  async createTask({ task }) {
    this.createAttempts += 1;
    if (this.tasks.has(task.name)) {
      throw Object.assign(new Error('task already exists'), { code: 6 });
    }
    const stored = copyTask(task);
    this.tasks.set(task.name, stored);
    return [copyTask(stored)];
  }

  async getTask({ name }) {
    this.lookups += 1;
    const task = this.tasks.get(name);
    if (!task) throw Object.assign(new Error('task not found'), { code: 5 });
    return [copyTask(task)];
  }

  body(name) {
    const task = this.tasks.get(name);
    if (!task) throw new Error(`missing fake Cloud Task: ${name}`);
    return JSON.parse(Buffer.from(task.httpRequest.body).toString('utf8'));
  }
}

export function createMemoryGcs() {
  const objects = new Map();
  const calls = { save: 0, read: 0, metadata: 0, delete: 0, public: 0, signed: 0 };
  let nextGeneration = 1000;
  const bucket = {
    file(name, options = {}) {
      const selectedGeneration = options.generation ? String(options.generation) : null;
      return {
        async save(body, saveOptions) {
          calls.save += 1;
          if (objects.has(name) && saveOptions?.preconditionOpts?.ifGenerationMatch === 0) {
            throw Object.assign(new Error('precondition failed'), { code: 412 });
          }
          const bytes = Buffer.from(body);
          objects.set(name, {
            body: bytes,
            metadata: {
              generation: String(nextGeneration++),
              size: String(bytes.length),
              contentType: saveOptions.metadata.contentType,
              cacheControl: saveOptions.metadata.cacheControl,
              metadata: { ...saveOptions.metadata.metadata },
            },
          });
        },
        async getMetadata() {
          calls.metadata += 1;
          const record = objects.get(name);
          if (!record || (selectedGeneration && selectedGeneration !== record.metadata.generation)) {
            throw Object.assign(new Error('object not found'), { code: 404 });
          }
          return [{ ...record.metadata, metadata: { ...record.metadata.metadata } }];
        },
        async download() {
          calls.read += 1;
          const record = objects.get(name);
          if (!record || (selectedGeneration && selectedGeneration !== record.metadata.generation)) {
            throw Object.assign(new Error('object not found'), { code: 404 });
          }
          return [Buffer.from(record.body)];
        },
        delete() {
          calls.delete += 1;
          throw new Error('delete is forbidden in the Phase 2 proof');
        },
        makePublic() {
          calls.public += 1;
          throw new Error('public access is forbidden in the Phase 2 proof');
        },
        getSignedUrl() {
          calls.signed += 1;
          throw new Error('signed URLs are forbidden in the Phase 2 proof');
        },
      };
    },
  };
  return {
    storage: { bucket: () => bucket },
    objects,
    calls,
  };
}

export function createFakeVertexClient({ permanentTransientJobs = [19] } = {}) {
  const calls = [];
  const client = {
    models: {
      async generateContent(request) {
        const packet = JSON.parse(request.contents[0].parts[0].text);
        const task = packet.task;
        calls.push({
          job_id: task.job_id,
          attempt_number: task.attempt_number,
          model: request.model,
        });
        const jobNumber = Number(task.job_id.split('-').at(-1));
        if ([15, 16, 17].includes(jobNumber) && task.attempt_number === 1) {
          throw Object.assign(new Error('synthetic rate limit'), { status: 429 });
        }
        if (jobNumber === 18) {
          throw Object.assign(new Error('synthetic ambiguous disconnect'), { code: 'ECONNRESET' });
        }
        if (permanentTransientJobs.includes(jobNumber)) {
          throw Object.assign(new Error('synthetic rate limit'), { status: 429 });
        }
        const output = {
          schema: 'famtastic.execution.vertex-observation.v1',
          job_id: task.job_id,
          task_id: task.task_id,
          packet_id: task.packet_id,
          project_id: task.project_id,
          review_status: 'ready_for_review',
          summary: `Synthetic shadow observation for ${task.job_id}.`,
          observations: [{
            code: 'proof.synthetic',
            severity: 'info',
            statement: 'Hermetic provider response created for proof only.',
            evidence_refs: [`packet:${task.packet_id}`],
          }],
        };
        return {
          responseId: `fake-response-${task.job_id}-${task.attempt_number}`,
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 200,
            thoughtsTokenCount: 0,
            cachedContentTokenCount: 0,
            totalTokenCount: 1200,
          },
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: JSON.stringify(output) }] },
          }],
        };
      },
    },
  };
  return { client, calls };
}

export function installProcessNetworkGuard() {
  const attempts = { fetch: 0, http: 0, https: 0, net: 0, tls: 0 };
  const originals = [];
  const block = (target, key, counter) => {
    const original = target[key];
    originals.push(() => { target[key] = original; });
    target[key] = () => {
      attempts[counter] += 1;
      throw new Error(`network denied during Phase 2 proof: ${counter}`);
    };
  };
  if (typeof globalThis.fetch === 'function') block(globalThis, 'fetch', 'fetch');
  block(http, 'request', 'http');
  block(http, 'get', 'http');
  block(https, 'request', 'https');
  block(https, 'get', 'https');
  block(net, 'connect', 'net');
  block(net, 'createConnection', 'net');
  block(tls, 'connect', 'tls');
  return {
    attempts,
    restore() {
      for (const restore of originals.reverse()) restore();
    },
  };
}
