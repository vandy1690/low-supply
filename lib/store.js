// Where families are kept. Two stores with one shape:
//   get(key)             -> { value, etag } or null
//   put(key, value, etag) -> etag of the saved copy. etag null means "must be new".
//                            Throws Conflict when someone else saved first.
//   del(key), list(prefix)
// On this Mac it is a folder of JSON files. Deployed, it is a private Vercel Blob store,
// chosen by the presence of BLOB_READ_WRITE_TOKEN.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';

export class Conflict extends Error {}

const safeKey = key => {
  if (!/^[a-z]\/[A-Za-z0-9_-]{6,80}$/.test(key)) throw new Error('bad key');
  return key;
};

export function fileStore(dir) {
  const file = key => path.join(dir, safeKey(key).replace('/', '-') + '.json');
  const tagOf = text => createHash('sha1').update(text).digest('hex');
  // One process, so a queue per store is enough to make read-compare-write safe.
  let queue = Promise.resolve();
  const locked = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const read = async key => { try { return await readFile(file(key), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  return {
    async get(key) {
      const text = await read(key);
      return text === null ? null : { value: JSON.parse(text), etag: tagOf(text) };
    },
    put(key, value, etag) {
      return locked(async () => {
        const current = await read(key);
        if (etag === null ? current !== null : current === null || tagOf(current) !== etag) throw new Conflict();
        const text = JSON.stringify(value);
        await mkdir(dir, { recursive: true });
        const tmp = file(key) + '.' + process.pid + '.tmp';
        await writeFile(tmp, text, { mode: 0o600 });
        await rename(tmp, file(key));
        return tagOf(text);
      });
    },
    del(key) { return locked(async () => { try { await unlink(file(key)); } catch (e) { if (e.code !== 'ENOENT') throw e; } }); },
    async list(prefix) {
      let names = [];
      try { names = await readdir(dir); } catch { return []; }
      const p = prefix.replace('/', '-');
      return names.filter(n => n.startsWith(p) && n.endsWith('.json')).map(n => n.slice(0, -5).replace('-', '/'));
    }
  };
}

export async function blobStore() {
  const blob = await import('@vercel/blob');
  const pathOf = key => `low-supply/${safeKey(key)}.json`;
  // get() returns a weak ETag (W/"abc") and ifMatch wants the strong form. Left on,
  // every save fails while every read works. Family Shifts lost a day to this.
  const strong = e => (typeof e === 'string' ? e.replace(/^W\//, '') : e);
  return {
    async get(key) {
      let result;
      try { result = await blob.get(pathOf(key), { access: 'private', useCache: false }); }
      catch (e) { if (e instanceof blob.BlobNotFoundError) return null; throw e; }
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = await new Response(result.stream).text();
      return { value: JSON.parse(text), etag: strong(result.blob.etag) };
    },
    async put(key, value, etag) {
      try {
        const saved = await blob.put(pathOf(key), JSON.stringify(value), {
          access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60,
          ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false })
        });
        return strong(saved.etag);
      } catch (e) {
        if (e instanceof blob.BlobPreconditionFailedError || !etag) throw new Conflict();
        throw e;
      }
    },
    async del(key) { try { await blob.del(pathOf(key)); } catch { /* already gone */ } },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const page = await blob.list({ prefix: `low-supply/${prefix}`, cursor });
        for (const b of page.blobs) out.push(b.pathname.replace(/^low-supply\//, '').replace(/\.json$/, ''));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    }
  };
}

export async function defaultStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStore();
  return fileStore(process.env.LOW_SUPPLY_DATA || path.join(process.cwd(), 'data'));
}
