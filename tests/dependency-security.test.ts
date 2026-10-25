import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Hono } from "hono";
import { serveStatic } from "hono/serve-static";
import uri from "fast-uri";
import { Address4, Address6 } from "ip-address";

test("URI parsing rejects ambiguous authorities while preserving valid hosts", () => {
	for (const url of ["http://a@b@evil.example/", "http://exa\tmple.com/", "http://exa\nmple.com/"]) {
		assert.ok(uri.parse(url).error, url);
	}
	assert.equal(uri.parse("https://example.com/paper?q=1").host, "example.com");
});

test("IP subnet checks cannot cross address families", () => {
	const v4 = new Address4("192.168.1.1");
	const v6 = new Address6("::/0");
	assert.equal(v4.isInSubnet(v6), false);
	assert.equal(v4.isHostInSubnet(v6), false);
	assert.equal(v4.isHostInSubnet(new Address4("192.168.1.0/24")), true);
});

test("attacker-sized brace and IPv6-zone inputs stay within a bounded process", () => {
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
		import assert from 'node:assert/strict';
		import {expand} from 'brace-expansion';
		import {Address6} from 'ip-address';
		const pattern = '{a}' + '}'.repeat(128000) + ',z}';
		assert.deepEqual(expand(pattern), [pattern]);
		assert.equal(expand('{a},z}').length, 2);
		assert.equal(Address6.isValid('%'.repeat(200000) + '\\n'), false);
		assert.equal(Address6.isValid('2001:db8::1%eth0'), true);
	`], { encoding: "utf8", timeout: 3000 });
	assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

test("static middleware cannot decode a protected path after routing", async () => {
	const app = new Hono();
	app.use("/static/admin/*", async (c) => c.text("Unauthorized", 401));
	app.use("/static/*", serveStatic({ getContent: async (path) => new Response(path) }));
	assert.equal((await app.request("/static/admin/secret.txt")).status, 401);
	for (const path of ["/static/%%36%31dmin/secret.txt", "/static/%2Fadmin/secret.txt"]) {
		assert.equal((await app.request(path)).status, 404, path);
	}
	const response = await app.request("/static/hello%20world.txt");
	assert.equal(response.status, 200);
	assert.equal(await response.text(), "static/hello world.txt");
});
