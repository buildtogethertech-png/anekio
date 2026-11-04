#!/usr/bin/env python3
"""Anekio alerts in Grafana Cloud: email contact point, notification policy and 8 alert rules.

Needs GRAFANA_API_TOKEN (service account, Admin) and GRAFANA_STACK_BASE in deploy/aws/.grafana.env.
  python3 deploy/grafana/alerts.py apply        create / update everything (safe to re-run)
  python3 deploy/grafana/alerts.py check        run every rule's query now and show value vs threshold
  python3 deploy/grafana/alerts.py test-email   send Grafana's test notification to the contact point
  python3 deploy/grafana/alerts.py fire-test    temporary rule that fires, then resolves, then is removed
"""
import json, os, ssl, sys, time, urllib.error, urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parents[1] / "aws" / ".grafana.env"
cfg = {}
for line in ENV.read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip("\"'")
TOKEN = cfg.get("GRAFANA_API_TOKEN", "")
BASE = cfg.get("GRAFANA_STACK_BASE", "https://stoutgrotto3198.grafana.net").rstrip("/")
EMAIL = cfg.get("ALERT_EMAIL", "support@anekio.com")
if not TOKEN.startswith("glsa_"):
    sys.exit("Add GRAFANA_API_TOKEN=\"glsa_…\" (service account, Admin role) to deploy/aws/.grafana.env")

# python.org builds on macOS ship without CA certificates: fall back to the system bundle.
SSL_CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)

FOLDER, GROUP, CONTACT = "anekio", "anekio", "Anekio email"
DASH = f"{BASE}/d/anekio-server"
N, PG, CW = 'instance="anekio-prod"', 'instance="anekio-prod-db"', 'dimension_DBInstanceIdentifier="anekio-prod-db"'


def api(method, path, body=None, ok=(200, 201, 202, 204)):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Disable-Provenance", "true")  # keep rules editable in the Grafana UI
    try:
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        if e.code in ok:
            return e.code, None
        return e.code, raw


def datasource(suffix):
    _, items = api("GET", "/api/datasources")
    for d in items:
        if d["name"].endswith(suffix):
            return d["uid"]
    sys.exit(f"No datasource ending in {suffix}")


PROM, LOKI = datasource("-prom"), datasource("-logs")

# title, severity, datasource, query, comparison, threshold, pending, no-data state, summary
RULES = [
    ("Server down", "critical", PROM, f'max(up{{job="integrations/node_exporter",{N}}}) or vector(0)', "lt", 1, "3m", "Alerting",
     "EC2 server anekio-prod is not reporting. The site is probably down."),
    ("Database down", "critical", PROM, f"max(pg_up{{{PG}}}) or vector(0)", "lt", 1, "3m", "Alerting",
     "RDS Postgres anekio-prod-db is not reachable from the server."),
    ("Site errors (5xx)", "critical", LOKI, 'sum(count_over_time({job="anekio-nginx"} | json status="status" | status >= 500 [5m])) or vector(0)', "gt", 10, "0s", "OK",
     "More than 10 server errors (5xx) in the last 5 minutes."),
    ("Disk almost full", "warning", PROM, f'max((1 - node_filesystem_avail_bytes{{mountpoint="/",{N}}} / node_filesystem_size_bytes{{mountpoint="/",{N}}}) * 100)', "gt", 85, "5m", "OK",
     "EC2 disk is over 85% full."),
    ("RAM full", "warning", PROM, f"max((1 - node_memory_MemAvailable_bytes{{{N}}} / node_memory_MemTotal_bytes{{{N}}}) * 100)", "gt", 90, "10m", "OK",
     "EC2 memory has been over 90% for 10 minutes."),
    ("CPU high", "warning", PROM, f'100 - avg(rate(node_cpu_seconds_total{{mode="idle",{N}}}[5m])) * 100', "gt", 85, "10m", "OK",
     "EC2 CPU has been over 85% for 10 minutes."),
    ("DB CPU high", "warning", PROM, f"max(aws_rds_cpuutilization_average{{{CW}}})", "gt", 80, "15m", "OK",
     "RDS CPU has been over 80% for 15 minutes."),
    ("DB storage low", "warning", PROM, f"max(aws_rds_free_storage_space_average{{{CW}}}) / 1024 / 1024 / 1024", "lt", 3, "5m", "OK",
     "RDS has less than 3 GB of free storage."),
]


def rule_body(uid, title, severity, ds, expr, op, threshold, pending, nodata, summary, group=GROUP):
    query = {"refId": "A", "expr": expr, "instant": True}
    if ds == LOKI:
        query = {"refId": "A", "expr": expr, "queryType": "instant"}
    return {
        "uid": uid, "title": title, "folderUID": FOLDER, "ruleGroup": group, "condition": "C",
        "for": pending, "noDataState": nodata, "execErrState": "Error",
        "labels": {"severity": severity, "app": "anekio"},
        "annotations": {"summary": summary, "description": f"Value now: {{{{ $values.B }}}} (alert when {op} {threshold})", "runbook_url": DASH},
        "data": [
            {"refId": "A", "relativeTimeRange": {"from": 600, "to": 0}, "datasourceUid": ds, "model": query},
            {"refId": "B", "datasourceUid": "__expr__", "model": {"refId": "B", "type": "reduce", "expression": "A", "reducer": "last", "settings": {"mode": "replaceNN", "replaceWithValue": 0}}},
            {"refId": "C", "datasourceUid": "__expr__", "model": {"refId": "C", "type": "threshold", "expression": "B", "conditions": [{"evaluator": {"type": op, "params": [threshold]}}]}},
        ],
    }


def uid_for(title):
    return "anekio-" + "".join(c if c.isalnum() else "-" for c in title.lower()).strip("-")[:30]


def apply():
    code, _ = api("POST", "/api/folders", {"uid": FOLDER, "title": "Anekio"}, ok=(200, 409, 412))
    print(f"folder Anekio: {code}")
    contact = {"uid": "anekio-email", "name": CONTACT, "type": "email", "settings": {"addresses": EMAIL, "singleEmail": True}, "disableResolveMessage": False}
    code, _ = api("PUT", "/api/v1/provisioning/contact-points/anekio-email", contact)
    if code not in (200, 202):
        code, res = api("POST", "/api/v1/provisioning/contact-points", contact)
        if code not in (200, 201, 202):
            sys.exit(f"contact point failed: {code} {res}")
    print(f"contact point → {EMAIL}: ok")
    policy = {"receiver": CONTACT, "group_by": ["alertname"], "group_wait": "30s", "group_interval": "5m", "repeat_interval": "4h"}
    code, res = api("PUT", "/api/v1/provisioning/policies", policy)
    print(f"notification policy (repeat every 4h): {code if code != 202 else 'ok'} {res or ''}")
    group = {"title": GROUP, "folderUid": FOLDER, "interval": 60,
             "rules": [rule_body(uid_for(r[0]), *r) for r in RULES]}
    code, res = api("PUT", f"/api/v1/provisioning/folder/{FOLDER}/rule-groups/{GROUP}", group)
    if code not in (200, 202):
        sys.exit(f"rule group failed: {code} {res}")
    print(f"{len(RULES)} alert rules: ok")


def query_value(ds, expr):
    q = {"refId": "A", "datasource": {"uid": ds}, "expr": expr, "instant": True, "queryType": "instant", "maxDataPoints": 1}
    now = int(time.time() * 1000)
    code, res = api("POST", "/api/ds/query", {"queries": [q], "from": str(now - 600_000), "to": str(now)})
    if code != 200:
        return f"query error {code}: {str(res)[:120]}"
    frames = res["results"]["A"].get("frames", [])
    values = [v for f in frames for v in (f["data"]["values"][-1] if f["data"]["values"] else [])]
    return values[-1] if values else None


def check():
    for title, sev, ds, expr, op, th, *_ in RULES:
        v = query_value(ds, expr)
        if isinstance(v, (int, float)):
            fires = v > th if op == "gt" else v < th
            print(f"{'🔴 WOULD FIRE' if fires else '🟢 ok'}  {title:<20} now={v:.2f}  alert when {op} {th}")
        else:
            print(f"⚪ {title:<20} {v}")
    _, rules = api("GET", "/api/prometheus/grafana/api/v1/rules")
    for g in rules["data"]["groups"]:
        if g["name"] == GROUP:
            print("Grafana states:", ", ".join(f"{r['name']}={r['state']}/{r.get('health')}" for r in g["rules"]))


def test_email():
    _, settings = api("GET", "/api/frontend/settings")
    ns = settings.get("namespace", "default")
    base = f"/apis/notifications.alerting.grafana.app/v1beta1/namespaces/{ns}/receivers"
    _, receivers = api("GET", base)
    rec = next((r for r in receivers.get("items", []) if r["spec"]["title"] == CONTACT), None)
    if not rec:
        sys.exit("Run apply first: contact point not found.")
    code, res = api("POST", f"{base}/{rec['metadata']['name']}/test", {"integration": rec["spec"]["integrations"][0]})
    print(f"test email to {EMAIL}: HTTP {code} {json.dumps(res)[:200] if res else ''}")


def wait_state(uid, want, timeout=240):
    end = time.time() + timeout
    while time.time() < end:
        _, rules = api("GET", "/api/prometheus/grafana/api/v1/rules")
        for g in rules["data"]["groups"]:
            for r in g["rules"]:
                if r["name"].startswith("TEST") and r["state"] in want:
                    return r["state"]
        time.sleep(10)
    return None


def fire_test():
    uid, group = "anekio-test-fire", "anekio-test"
    def put(expr):
        body = rule_body(uid, "TEST alert — please ignore", "test", PROM, expr, "gt", 0, "0s", "OK",
                         "Test from deploy/grafana/alerts.py. A 'Resolved' email follows in a few minutes.", group=group)
        return api("PUT", f"/api/v1/provisioning/folder/{FOLDER}/rule-groups/{group}", {"title": group, "folderUid": FOLDER, "interval": 10, "rules": [body]})
    print("1) test rule that always fires:", put("vector(1)")[0])
    print("   state:", wait_state(uid, {"firing"}), "→ 'Firing' email within ~1 min")
    time.sleep(60)
    print("2) make it normal:", put("vector(0)")[0])
    print("   state:", wait_state(uid, {"inactive", "normal"}), "→ 'Resolved' email within ~5 min")
    time.sleep(330)
    code, _ = api("DELETE", f"/api/v1/provisioning/folder/{FOLDER}/rule-groups/{group}")
    print("3) test rule removed:", code)


if __name__ == "__main__":
    {"apply": apply, "check": check, "test-email": test_email, "fire-test": fire_test}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: print(__doc__))()
