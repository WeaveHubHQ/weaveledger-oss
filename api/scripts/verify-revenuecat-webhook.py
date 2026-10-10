#!/usr/bin/env python3
"""End-to-end check of POST /api/webhooks/revenuecat against a running API.

  wrangler dev --var RC_WEBHOOK_SECRET:local-test-secret        (local D1, migrations applied)
  WL_EMAIL=... WL_PASSWORD=... python3 scripts/verify-revenuecat-webhook.py

Uses one existing account and leaves it Pro. Never point this at production:
it rewrites that account's subscription state.
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ.get("WL_BASE", "http://localhost:8787")
SECRET = os.environ.get("RC_WEBHOOK_SECRET", "local-test-secret")
if urllib.parse.urlparse(BASE).hostname not in {"localhost", "127.0.0.1"}:
    sys.exit("refusing to run against a non-local API")


def call(method, path, body=None, headers=None):
    h = {"content-type": "application/json", **(headers or {})}
    data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
    try:
        r = urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=h, method=method))
        return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:120]


_, login = call("POST", "/api/auth/login", {"email": os.environ["WL_EMAIL"], "password": os.environ["WL_PASSWORD"]})
login = login.get("data") or login
TOKEN, USER = login["token"], login["user"]["id"]
AUTH = {"Authorization": "Bearer " + TOKEN}
RUN = str(int(time.time() * 1000))
NOW = int(time.time() * 1000)
DAY = 86400000
# Default event stamps sit past the server's future-skew clamp, so each one is
# clamped to "now" on arrival: always at least as new as anything a previous
# run left behind, which keeps the script re-runnable.
STAMP = NOW + 6 * 60000
seq = [0]


def hook(type_, secret=SECRET, raw=None, **fields):
    seq[0] += 1
    ev = {"id": f"{RUN}-{seq[0]}", "type": type_, "environment": "PRODUCTION", "entitlement_ids": ["pro"],
          "event_timestamp_ms": STAMP + seq[0], **fields}
    ev = {k: v for k, v in ev.items() if v is not None}
    status, body = call("POST", "/api/webhooks/revenuecat", raw or {"event": ev}, {"Authorization": "Bearer " + secret})
    return status, (body["data"]["status"] if isinstance(body, dict) and "data" in body else body)


def tier():
    return call("GET", "/api/app-subscription/status", headers=AUTH)[1]["data"]["subscription_tier"]


failed = []


def check(name, cond, got):
    print(("PASS " if cond else "FAIL ") + name + "  -> " + str(got)[:100])
    if not cond:
        failed.append(name)


s, d = hook("RENEWAL", secret="wrong", app_user_id=USER); check("wrong secret is 401", s == 401, (s, d))
s, d = hook("x", raw=b"{not json"); check("bad JSON is 400", s == 400, (s, d))
s, d = hook("EXPIRATION", app_user_id=USER, expiration_at_ms=NOW - 10 * DAY); check("expiration -> free", d == "applied" and tier() == "free", (d, tier()))
s, d = hook("INITIAL_PURCHASE", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY, environment="SANDBOX"); check("sandbox purchase never grants", d == "skipped_sandbox" and tier() == "free", (d, tier()))
s, d = hook("INITIAL_PURCHASE", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY, entitlement_ids=["other"]); check("other entitlement never grants", d == "skipped_entitlement" and tier() == "free", (d, tier()))
s, d = hook("INITIAL_PURCHASE", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY, entitlement_ids=None, product_id="some.other.product"); check("no entitlement list + unknown product never grants", d == "skipped_entitlement" and tier() == "free", (d, tier()))
s, d = hook("INITIAL_PURCHASE", app_user_id=USER, expiration_at_ms="soon"); check("garbage expiry is not Pro and not a 500", s == 200 and tier() == "free", (s, d, tier()))
s, d = hook("RENEWAL", app_user_id=USER, expiration_at_ms=NOW - 10 * DAY); check("renewal already expired is not Pro", tier() == "free", (d, tier()))
s, d = hook("INITIAL_PURCHASE", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY); check("purchase -> pro", d == "applied" and tier() == "pro", (d, tier()))
seq[0] -= 1
s, d = hook("INITIAL_PURCHASE", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY); check("replay is a no-op", d == "duplicate", d)
s, d = hook("EXPIRATION", app_user_id=USER, expiration_at_ms=NOW - DAY, event_timestamp_ms=NOW - 5 * DAY); check("older expiration cannot undo it", d == "skipped_stale" and tier() == "pro", (d, tier()))
s, d = hook("CANCELLATION", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY); check("cancellation keeps pro", d == "applied" and tier() == "pro", (d, tier()))
s, d = hook("RENEWAL", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY, event_timestamp_ms=NOW + 400 * DAY); check("far-future timestamp is clamped", d == "applied", d)
time.sleep(0.01)
s, d = hook("RENEWAL", app_user_id=USER, expiration_at_ms=NOW + 31 * DAY, event_timestamp_ms=int(time.time() * 1000) + 10 * 60000); check("...so a later event still applies", d == "applied", d)
s, d = hook("RENEWAL", app_user_id=USER, expiration_at_ms=NOW + 32 * DAY, entitlement_ids=None, product_id="app.weavehub.weaveledger.pro.monthly", event_timestamp_ms=int(time.time() * 1000) + 10 * 60000); check("no entitlement list + our SKU applies", d == "applied", d)
s, d = hook("RENEWAL", app_user_id=USER, expiration_at_ms=NOW + 300 * DAY, product_id="app.weavehub.weaveledger.pro.annual"); check("switch to annual", d == "applied", d)
s, d = hook("EXPIRATION", app_user_id=USER, expiration_at_ms=NOW - DAY, product_id="app.weavehub.weaveledger.pro.monthly"); check("old monthly expiring does not end the annual", d == "skipped_superseded" and tier() == "pro", (d, tier()))
s, d = hook("CANCELLATION", app_user_id=USER, expiration_at_ms=NOW - 1000, product_id="app.weavehub.weaveledger.pro.annual"); check("refund of the current product -> free", d == "applied" and tier() == "free", (d, tier()))
s, d = hook("RENEWAL", app_user_id=USER, expiration_at_ms=NOW + 30 * DAY, product_id="app.weavehub.weaveledger.pro.monthly"); check("back to pro", d == "applied" and tier() == "pro", (d, tier()))
s, d = hook("RENEWAL", app_user_id="$RCAnonymousID:abc"); check("anonymous id is skipped", d == "skipped_no_user", d)
s, d = hook("RENEWAL", app_user_id="usr_" + "0" * 32, expiration_at_ms=NOW + DAY); check("unknown usr_ is skipped", d == "skipped_no_user", d)
s, d = hook("RENEWAL", app_user_id="$RCAnonymousID:abc", aliases=[USER], expiration_at_ms=NOW + 60 * DAY); check("alias resolves the user", d == "applied", d)
s, d = hook("TRANSFER", entitlement_ids=None, transferred_from=[USER], transferred_to=["usr_" + "0" * 32]); check("transfer away -> free", d == "applied" and tier() == "free", (d, tier()))
s, d = hook("TRANSFER", entitlement_ids=None, transferred_from=["$RCAnonymousID:abc"], transferred_to=[USER]); check("transfer in -> tier pro (expiry from next renewal)", d == "applied", d)
s, d = hook("TRANSFER", entitlement_ids=None, transferred_from=["$RCAnonymousID:a"], transferred_to=["$RCAnonymousID:b"]); check("transfer with no known users is skipped", d == "skipped_no_user", d)
s, d = hook("RENEWAL", app_user_id=USER, expiration_at_ms=NOW + 400 * DAY); check("renewal -> pro (final state)", d == "applied" and tier() == "pro", (d, tier()))

print("ALL PASS" if not failed else f"{len(failed)} FAILED: {failed}")
sys.exit(1 if failed else 0)
