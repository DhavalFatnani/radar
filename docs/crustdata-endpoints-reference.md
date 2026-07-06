# Crustdata Endpoints — Integration Reference

**Purpose:** a portable, self-contained handoff. Everything another project needs
to call the Crustdata endpoints we have already integrated, without re-deriving
auth, request shapes, response field paths, or costs.

**Provenance:** every endpoint, field path, operator, and cost below was confirmed
against the **live** Crustdata API while building *Ops Expansion Radar*
(verified 2026-06). Nothing here is copied from a doc unverified — if it's listed,
we saw it in a real response.

- **Base URL:** `https://api.crustdata.com`
- **API version header value:** `2025-11-01` (valid: `2025-01-01` or `2025-11-01`)
- **Key:** a single bearer token. Store in an env var (`CRUSTDATA_API_KEY`),
  never in code. Get/regenerate it at `app.crustdata.com`.

---

## 1. What's integrated, at a glance

| # | Endpoint | Method | Purpose | Auth | Cost |
|---|---|---|---|---|---|
| 1 | `/company/search` | POST | Discover companies by funding / headcount / geo filters | Bearer + version | ~0.03 / row returned |
| 2 | `/data_lab/job_listings/Table/` | POST | Job postings for a company (ops-hiring signal) | Bearer + version (Token fallback) | 0 on trial; re-measure off trial |
| 3 | `/person/search` | POST | Find people (decision-makers) by company + title | Bearer + version | ~0.03 / result returned |
| 4 | `/person/search/autocomplete` | POST | Free auth/key probe (zero-credit) | Bearer + version | Free |
| 5 | `/user/credits` | GET | Live credit balance (legacy only) | Bearer or Token | Free — **404 on current keys** |

> **Failures are free.** Any 4xx (bad auth, wrong version, bad filter) returns no
> data and costs nothing. A successful 200 matching **zero** rows also costs
> nothing — billing is per row *returned*. Wrong calls are self-protecting: verify
> cheaply, then scale.

---

## 2. Auth & versioning — split by endpoint generation

There is **no single auth scheme**. It depends on the endpoint generation.

| Endpoint | Auth header | Version header |
|---|---|---|
| `/company/search` | `Authorization: Bearer <key>` | `x-api-version: 2025-11-01` (required) |
| `/person/search` | `Authorization: Bearer <key>` | `x-api-version: 2025-11-01` (required) |
| `/person/search/autocomplete` | `Authorization: Bearer <key>` | `x-api-version: 2025-11-01` |
| `/data_lab/job_listings/Table/` | `Authorization: Bearer <key>` (legacy `Token <key>` still works on some keys) | `x-api-version: 2025-11-01` |
| `/user/credits` | `Bearer` **or** legacy `Token` | — |

**Recommended client behavior:** send `Bearer + x-api-version` first; on `401`
only, retry once with the legacy `Authorization: Token <key>` header (no version).
This single fallback covers every key generation we encountered.

All POST bodies are JSON; always send `Content-Type: application/json`.

### Gotchas
- `GET /user/credits` is **gone (404 Route Not Found)** for current keys with both
  Bearer and Token. Don't depend on it for balance — read the dashboard, or
  track spend yourself from returned row counts (see §4).
- `/company/search` **rejects** `x-api-version: 2024-11-01`. Valid values are
  `2025-01-01` or `2025-11-01`; the error body lists the accepted set.
- The old `/screener/screen/` company-search endpoint is **deprecated** (404 with
  a pointer to v2 `/company/search`).

---

## 3. Endpoint-by-endpoint reference

### 3.1 `POST /company/search` — discovery

The cheap discovery pass. Returns structured company objects.

**Request body**
```json
{
  "filters": { "op": "and", "conditions": [
    { "field": "locations.country",           "type": "=",      "value": "IND" },
    { "field": "funding.last_fundraise_date",  "type": ">",      "value": "2025-06-08" },
    { "field": "funding.last_round_type",      "type": "not_in", "value": ["post_ipo_debt","post_ipo_equity","post_ipo_secondary","grant"] }
  ]},
  "fields": ["basic_info", "funding", "headcount", "locations", "taxonomy"],
  "limit": 25,
  "sorts": [{ "field": "funding.last_fundraise_date", "order": "desc" }],
  "cursor": "<next_cursor from a previous page, optional>"
}
```

**Response**
```json
{ "companies": [ { ... } ], "next_cursor": "...", "total_count": 1234 }
```
`next_cursor: null` ⇒ last page. Pass it back as `cursor` to page forward.

**Confirmed response field paths we consume** (per company object):
| Path | Meaning |
|---|---|
| `basic_info.name` | Company name |
| `basic_info.primary_domain` | Canonical domain (join key into job_listings) |
| `basic_info.industries` | Array of industry tags |
| `locations.country` | ISO-ish country code (e.g. `IND`) |
| `funding.last_fundraise_date` | Most recent raise date (ISO) |
| `funding.last_round_type` | e.g. `series_a`, `seed`, `post_ipo_debt` |
| `funding.last_round_amount_usd` | Amount of last round |
| `funding.total_investment_usd` | Lifetime funding |
| `headcount.total` | Total employees |
| `headcount.growth_percent.{1m,3m,6m,12m}` | Headcount growth % over window |
| `headcount.growth_absolute.{1m,3m,6m,12m}` | Headcount growth (absolute) |

**Notes / gotchas**
- `limit` 1–1000 (default 20). We hard-cap at 25 for credit safety — set your own.
- `basic_info.company_type` is **unreliable** for public-vs-private (entities
  tagged `"Privately Held"` still report `post_ipo_*` rounds). Filter on
  `funding.last_round_type` instead.
- Returns **total** headcount only — no ops-segment breakdown. Use job_listings
  (§3.2) for an ops-specific signal.
- Array fields (`basic_info.industries`, `taxonomy.categories`, `funding.investors`,
  `basic_info.markets`) filter with `in` + a list; match if any element matches.

---

### 3.2 `POST /data_lab/job_listings/Table/` — job postings

A **tabular** dataset endpoint — its request and response shape differ from the
company/person endpoints. Returns column metadata + row arrays, not objects.

**Request body** (note: filter keys here are `column`, **not** `field`)
```json
{
  "tickers": [],
  "dataset": { "name": "job_listings", "id": "joblisting" },
  "filters": { "op": "and", "conditions": [
    { "column": "company_website_domain", "type": "=",   "value": "swiggy.com" },
    { "column": "date_updated",           "type": "=>",  "value": "2025-06-15" },
    { "op": "or", "conditions": [
      { "column": "title", "type": "(.)", "value": "operations" },
      { "column": "title", "type": "(.)", "value": "warehouse" },
      { "column": "title", "type": "(.)", "value": "supply chain" }
    ]}
  ]},
  "offset": 0,
  "limit": 25,
  "sorts": [], "groups": [], "aggregations": [], "functions": []
}
```

**Response**
```json
{
  "fields": [ { "api_name": "title", ... }, { "api_name": "date_updated", ... }, ... ],
  "rows":   [ ["Warehouse Manager", "2026-02-01", ...], ... ],
  "is_trial_user": true
}
```
Zip it into dicts: `names = [f["api_name"] for f in fields]; [dict(zip(names, row)) for row in rows]`.

**Useful columns:** `title`, `category` (e.g. `"Operations"`), `number_of_openings`,
`date_added`, `date_updated`, `city`, `country`, `workplace_type`, `total_rows`.

**Gotchas (these caused the signal to read 0 before we fixed them):**
- **Slow.** Needs a 60–90s timeout; the default 30s times out. Also intermittently
  returns transient `404/502/503/504` — retry once after a short delay.
- **Filter ops titles server-side; don't sample-then-classify.** A domain can have
  thousands of postings (`total_rows`); an unfiltered `limit` of 5–25 almost never
  contains the ops roles. Use the nested `OR` group on `title` shown above.
- **The dataset is stale.** Ops postings routinely run 3–7 months old, and
  `__expired__` rows are mixed in. A 90-day `date_updated` window returned nothing
  for real companies; a **~365-day** window surfaces them. Get recency-of-intent
  from the funding signal, not from this dataset.
- **`category` is unusable for ops.** Real ops roles (Inventory Manager, Warehouse,
  Store Manager) land in `category="Others"`. Filter by **title terms**, not category.
- `(.)` is plain *contains*: `"ops"` matches `"DevOps"`. Exclude engineering titles
  explicitly if you want operators only.
- Cost was **0 on a trial account** (`is_trial_user: true`). Re-measure once off trial.

---

### 3.3 `POST /person/search` — people / decision-makers

**Request body** (filter keys here are `field`, like company/search)
```json
{
  "filters": { "op": "and", "conditions": [
    { "field": "experience.employment_details.current.company_name", "type": "in",  "value": ["Swiggy"] },
    { "op": "or", "conditions": [
      { "field": "experience.employment_details.current.title", "type": "(.)", "value": "Operations" },
      { "field": "experience.employment_details.current.title", "type": "(.)", "value": "COO" },
      { "field": "experience.employment_details.current.title", "type": "(.)", "value": "Supply Chain" }
    ]}
  ]},
  "limit": 3,
  "sorts": [ ... optional ... ],
  "cursor": "... optional ..."
}
```

**Response**
```json
{ "profiles": [ { ... } ], "next_cursor": "...", "total_count": N }
```

**Confirmed profile field paths we consume:**
| Path | Meaning |
|---|---|
| `basic_profile.name` | Person name |
| `basic_profile.current_title` | Current title string |
| `basic_profile.normalized_title.department` | Normalized dept (target COO / Head of Ops without title-string guessing) |
| `social_handles.professional_network_identifier.profile_url` | LinkedIn URL |

Each profile carries more than we use, enough to skip a separate enrich call:
- `headline`, `location`
- `basic_profile.normalized_title.{sub_department, seniority_level, matched_title, confident}`
- `experience.employment_details.current[]` — `title`, `seniority_level`,
  `function_category`, company info, `crustdata_company_id`, `crustdata_person_id`
- `contact.{has_business_email, has_personal_email, has_phone_number}` — **flags only**;
  actual contact details need the full person-enrich endpoint (not yet measured).

**Gotcha:** `(.)` is plain *contains*, **not** regex — a pipe alternation like
`"COO|Head of Operations"` matches **nothing**. Use one term per condition inside an
`OR` group (as above), or filter on `normalized_title.department` / `seniority_level`.

---

### 3.4 `POST /person/search/autocomplete` — free auth probe

Zero-credit. Use it to validate a key without spending anything.

**Request body**
```json
{ "field": "basic_profile.name", "query": "a", "limit": 1 }
```
`200` ⇒ key valid. `401` ⇒ invalid key. Any other non-200 ⇒ treat as a transient/
config error and surface the body.

---

### 3.5 `GET /user/credits` — legacy balance (mostly dead)

```
GET /user/credits      Bearer or legacy Token
```
Returns `{ "credits": <float> }` on legacy accounts. **404 on current
(2025-11-01) keys** with both auth headers. Don't build on it — see §4 for the
fallback we use.

---

## 4. Credit / cost model

- Billing is **per row returned** at **~0.03 credits/row** on `/company/search`
  and `/person/search`.
- `/data_lab/job_listings` was **free on trial** (`is_trial_user: true`) —
  re-measure once off trial.
- `/person/search/autocomplete` is **free**.
- Because `GET /user/credits` 404s on current keys, you cannot always read live
  balance. Our approach: **auto-track spend from returned row counts** on each
  successful 200, persisted to a small ledger file. When `/user/credits` *does*
  work (legacy keys), read balance before/after each call instead and trust that.
- Billable list keys to count rows from a 200 body: `companies`, `results`,
  `people`, `profiles` (whichever the endpoint returns).

**Discipline that kept us cheap:** discovery (`/company/search`) is the broad,
cheap pass; per-company enrichment (`/data_lab/job_listings`, `/person/search`)
runs on the **shortlist only**, never the full scan. Cap `limit` defensively.

---

## 5. Filter language (shared by company & person search)

`filters` is a recursive tree: a node is either a **condition** or a **group**.

- **Group:** `{ "op": "and" | "or", "conditions": [ <node>, ... ] }` — nestable.
- **Condition (company/person):** `{ "field": "<dot.path>", "type": "<op>", "value": <v> }`
- **Condition (data_lab job_listings):** same shape but the key is `"column"`, not `"field"`.

### Operators (confirmed)
| Operator | Meaning |
|---|---|
| `=` / `!=` | equals / not equals |
| `>` / `<` | greater / less than |
| `=>` / `=<` | **greater-or-equal / less-or-equal** (NOT `>=` / `<=` — those are unsupported) |
| `in` / `not_in` | value in / not in a list (also matches arrays element-wise) |
| `is_null` / `is_not_null` | presence checks |
| `(.)` | fuzzy / **contains** (plain substring, NOT regex) |
| `[.]` | exact token match |

### Sorting & pagination
- `"sorts": [{ "field": "<dot.path>", "order": "asc" | "desc" }]`.
  **Gotcha:** the key is `field`, not `column`, even though some doc mirrors say
  `column` (live API errors `Missing required field: 'sorts.0.field'`).
- `limit` 1–1000 (default 20). Response gives `next_cursor`; pass back as `cursor`.
  `next_cursor: null` ⇒ last page.

---

## 6. Drop-in minimal client (Python)

Self-contained — copy into the new project, set `CRUSTDATA_API_KEY`, and call.
Captures the Bearer→Token fallback, the data_lab retry, and the tabular row-zip.

```python
import os, time, requests

BASE_URL = "https://api.crustdata.com"
API_VERSION = "2025-11-01"

class Crustdata:
    def __init__(self, key: str | None = None):
        self.key = (key or os.environ["CRUSTDATA_API_KEY"]).strip()

    def _bearer(self):
        return {"Authorization": f"Bearer {self.key}",
                "x-api-version": API_VERSION,
                "Content-Type": "application/json"}

    def _token(self):  # legacy fallback for older keys
        return {"Authorization": f"Token {self.key}",
                "Content-Type": "application/json"}

    def _post(self, path, payload, timeout=30):
        url = f"{BASE_URL}{path}"
        last = None
        for headers in (self._bearer(), self._token()):
            last = requests.post(url, headers=headers, json=payload, timeout=timeout)
            if last.status_code != 401:
                return last
        return last

    def company_search(self, filters, fields, limit=25, sorts=None, cursor=None):
        payload = {"filters": filters, "fields": fields, "limit": limit}
        if sorts:  payload["sorts"] = sorts
        if cursor: payload["cursor"] = cursor
        return self._post("/company/search", payload)

    def person_search(self, filters, limit=3, sorts=None, cursor=None):
        payload = {"filters": filters, "limit": limit}
        if sorts:  payload["sorts"] = sorts
        if cursor: payload["cursor"] = cursor
        return self._post("/person/search", payload)

    def job_listings(self, conditions, limit=25):
        payload = {
            "tickers": [], "dataset": {"name": "job_listings", "id": "joblisting"},
            "filters": {"op": "and", "conditions": conditions},
            "offset": 0, "limit": limit,
            "sorts": [], "groups": [], "aggregations": [], "functions": [],
        }
        for attempt in range(2):  # data_lab is slow + flaky
            r = self._post("/data_lab/job_listings/Table/", payload, timeout=90)
            if r.status_code not in (404, 502, 503, 504):
                return r
            time.sleep(5)
        return r

    def verify_key(self) -> bool:  # free, zero-credit
        r = self._post("/person/search/autocomplete",
                       {"field": "basic_profile.name", "query": "a", "limit": 1})
        return r.status_code == 200

def rows_to_dicts(fields, rows):
    """Zip a data_lab tabular response into a list of dicts."""
    names = [f["api_name"] for f in fields]
    return [dict(zip(names, row)) for row in rows]
```

**Usage sketch**
```python
cd = Crustdata()
assert cd.verify_key()

# Discover
resp = cd.company_search(
    filters={"op": "and", "conditions": [
        {"field": "locations.country", "type": "=", "value": "IND"},
        {"field": "funding.last_fundraise_date", "type": ">", "value": "2025-06-08"},
    ]},
    fields=["basic_info", "funding", "headcount", "locations"],
    sorts=[{"field": "funding.last_fundraise_date", "order": "desc"}],
    limit=25,
)
companies = resp.json()["companies"]

# Ops postings for one company
jr = cd.job_listings([
    {"column": "company_website_domain", "type": "=", "value": "swiggy.com"},
    {"column": "date_updated", "type": "=>", "value": "2025-06-15"},
    {"op": "or", "conditions": [
        {"column": "title", "type": "(.)", "value": t}
        for t in ("operations", "warehouse", "supply chain", "logistics")
    ]},
])
jobs = rows_to_dicts(jr.json()["fields"], jr.json()["rows"])

# Decision-maker
pr = cd.person_search({"op": "and", "conditions": [
    {"field": "experience.employment_details.current.company_name", "type": "in", "value": ["Swiggy"]},
    {"op": "or", "conditions": [
        {"field": "experience.employment_details.current.title", "type": "(.)", "value": t}
        for t in ("Operations", "COO", "Supply Chain")
    ]},
]})
profiles = pr.json()["profiles"]
```

---

## 7. Not yet integrated (measure before relying on)

- **`/company/enrich`** and **`/person/enrich`** — full profiles incl. emails.
  Only needed if you want actual contact details (person_search returns
  has-email/phone *flags* only). Cost not yet measured.
- **`/data_lab/job_listings` cost off the trial tier** — was free on trial; confirm
  the real per-row cost before scaling.

---

## 8. Integration checklist for the new project

1. Put the key in an env var (`CRUSTDATA_API_KEY`); never commit it.
2. Copy the client in §6; confirm auth with `verify_key()` (free).
3. Send `Bearer + x-api-version: 2025-11-01`; fall back to `Token` only on 401.
4. Remember the two filter dialects: `field` for company/person, `column` for
   data_lab job_listings.
5. Use `=>`/`=<`, never `>=`/`<=`. `(.)` is contains, not regex — one term per OR
   condition.
6. Give job_listings a 60–90s timeout + one retry; filter ops titles server-side;
   use a ~365-day `date_updated` window, not 90.
7. Enrich the shortlist only. Track spend from returned row counts (~0.03/row);
   don't depend on `/user/credits` (404 on current keys).
8. Treat a 4xx or a zero-row 200 as free — verify cheaply before scaling.
