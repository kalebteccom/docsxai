// The backend's `app_url` filter and the engine's request guard classify addresses with one rule
// set. The backend has no engine dependency and the engine none on the backend, so each carries
// its own copy of `address-class.ts`. These tests hold the copies to the same bytes, the same
// answers on a table of hosts in every spelling, and the same reading of the on/off switches.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as backendClass from "../../backend/src/address-class.js";
import {
  appUrlProblem,
  denyPrivateAppUrl,
  DENY_PRIVATE_APP_URL_ENV,
} from "../../backend/src/app-url.js";
import * as engineClass from "../../engine/src/address-class.js";
import { envFlagOn, requestProblem } from "../../engine/src/egress-guard.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const copy = (pkg: string): string =>
  readFileSync(path.join(here, "..", "..", pkg, "src", "address-class.ts"), "utf8");

const HOSTS = [
  "169.254.169.254",
  "169.254.0.1",
  "2852039166",
  "0xa9fea9fe",
  "0251.0376.0251.0376",
  "169.254.169.254.",
  "168.63.129.16",
  "168.63.129.17",
  "100.100.100.200",
  "100.100.100.201",
  "[::ffff:169.254.169.254]",
  "[::ffff:a9fe:a9fe]",
  "[64:ff9b::a9fe:a9fe]",
  "[64:ff9b:1::a9fe:a9fe]",
  "[64:ff9b:1::1]",
  "[64:ff9b:1:2:3:4:808:808]",
  "[::a9fe:a9fe]",
  "[2002:a9fe:a9fe::1]",
  "[2002:a00:1::1]",
  "[2002:808:808::1]",
  "[2001:0:a9fe:a9fe::1]",
  "[2001:0:4136:e378:8000:63bf:5601:5601]",
  "[2001:0:4136:e378:8000:63bf:f7f7:f7f7]",
  "[2001:db8::1]",
  "[fe80::1]",
  "[fe80::1%25eth0]",
  "[febf::1]",
  "[fec0::1]",
  "[feff::1]",
  "[fd00:ec2::254]",
  "[fd00:ec2::255]",
  "[fc00::1]",
  "[fd12:3456::1]",
  "[::1]",
  "[::]",
  "[::ffff:127.0.0.1]",
  "127.0.0.1",
  "127.1",
  "0.0.0.0",
  "10.0.0.1",
  "172.16.0.1",
  "172.15.0.1",
  "192.168.1.1",
  "100.64.0.1",
  "100.63.0.1",
  "8.8.8.8",
  "localhost",
  "localhost.",
  "LOCALHOST.LOCALDOMAIN",
  "ip6-localhost",
  "ip6-loopback",
  "app.localhost",
  "metadata.google.internal",
  "METADATA.GOOGLE.INTERNAL.",
  "instance-data",
  "example.com",
  "notmetadata.google.internal",
];

describe("address classification in the backend and the engine", () => {
  it("is the same file in both packages, byte for byte", () => {
    expect(copy("engine")).toBe(copy("backend"));
  });

  it.each(HOSTS)("agrees on %s", (host) => {
    for (const denyPrivate of [false, true]) {
      expect(engineClass.hostProblem(host, denyPrivate)).toBe(
        backendClass.hostProblem(host, denyPrivate),
      );
    }
  });

  it.each(HOSTS)(
    "refuses %s in an app_url exactly when the request guard refuses it",
    async (host) => {
      const resolvesPublic = () => Promise.resolve(["93.184.216.34"]);
      for (const denyPrivate of [false, true]) {
        const url = `http://${host}/`;
        const fromBackend = appUrlProblem(url, { denyPrivate });
        const fromEngine = await requestProblem(url, { denyPrivate, lookup: resolvesPublic });
        expect(fromEngine === null).toBe(fromBackend === null);
      }
    },
  );
});

describe("the on/off switches in the backend and the engine", () => {
  it.each([
    "1",
    "true",
    "TRUE",
    "yes",
    "Yes",
    " 1 ",
    "0",
    "false",
    "no",
    "",
    "2",
    "on",
    "y",
    "tru",
  ])("read %j alike", (value) => {
    expect(denyPrivateAppUrl({ [DENY_PRIVATE_APP_URL_ENV]: value })).toBe(envFlagOn(value));
  });
});
