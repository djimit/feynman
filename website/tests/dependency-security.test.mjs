import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import CachePolicy from 'http-cache-semantics';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const astroRoot = dirname(require.resolve('astro/package.json'));
const { loadRemoteImage, revalidateRemoteImage } = await import(
  pathToFileURL(join(astroRoot, 'dist/assets/build/remote.js')).href
);

test('oversized constrained arrays stop before reading elements', () => {
  const input = new Array(10_000);
  Object.defineProperty(input, 0, {
    get() { throw new Error('oversized input must not be traversed'); },
  });
  for (const schema of [z.array(z.number()).max(2), z.array(z.number()).length(2)]) {
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    assert.equal(result.error.issues.length, 1);
    assert.deepEqual(schema.parse([1, 2]), [1, 2]);
  }
});

test('Astro image caching never consults the client max-stale reuse decision', async () => {
  const original = CachePolicy.prototype.satisfiesWithoutRevalidation;
  CachePolicy.prototype.satisfiesWithoutRevalidation = () => {
    throw new Error('client-directed shared-cache reuse is outside this build path');
  };
  try {
    for (const cacheControl of ['private, max-age=3600', 'no-store', 'public, max-age=3600']) {
      const fetchImage = async () => new Response('image', {
        headers: { 'cache-control': cacheControl, 'set-cookie': 'session=test' },
      });
      for (const image of [
        await loadRemoteImage('https://example.invalid/image', fetchImage),
        await revalidateRemoteImage('https://example.invalid/image', {}, fetchImage),
      ]) {
        assert.equal(image.data.toString(), 'image');
        assert.equal(Object.hasOwn(image, 'headers'), false);
        if (cacheControl.startsWith('public')) assert.ok(image.expires > Date.now());
        else assert.ok(image.expires <= Date.now());
      }
    }
  } finally {
    CachePolicy.prototype.satisfiesWithoutRevalidation = original;
  }
});
