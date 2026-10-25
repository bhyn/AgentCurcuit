# Netflow

**A trade-terms simulator for small manufacturers.** Before accepting a big order, see how
prepayment, due dates and risky partners change your profit, your cash, and who ends up paid late.

Built for Cal Hacks 13.0 (CRS sponsor challenge). Partner risk comes from live calls to the
**CRS sandbox**; the trade network itself is fictional.

> Everything here uses CRS sandbox **test personas** (fake people). No real personal data is used or sent.

---

## The question it answers

Manufacturer B gets a large order from Customer A. A pays late with some probability, B owes
its suppliers on fixed dates, and B has limited cash and an emergency credit line.

> *"Under which terms can I take this order and still keep payments flowing through my network?"*

You move sliders (order size, prepayment, discount, due days, installments, cash, credit line,
economic stress) and watch thousands of simulated futures update.

## What is real and what is simulated

| Part | Status |
|---|---|
| Credit reports (TransUnion, Equifax, Experian) and PitchPoint liens, judgments, bankruptcies for each partner's owner | **Real CRS sandbox calls** (test personas) |
| RequestIDs, bureau score models, file statuses (no-hit, freeze) | Real, shown in the Evidence panel |
| Mapping from CRS evidence to late-payment / default odds | **Illustrative assumption** (see `lib/netflow/risk.ts`), not a CRS output and not calibrated |
| Trade network, order amounts, cash flows, suppliers | **Fictional** |
| Simulation | Monte Carlo, fixed seed, 3,000 futures |

The UI states this distinction on the page.

## How CRS is at the core

CRS does not offer business credit in this sandbox, so each partner is modeled as a small
business whose **owner** is a CRS test persona. The owner's bureau scores and public records set
that partner's payment risk. Swap a partner's persona and the app calls CRS again and the
whole simulation changes.

| Partner | Persona | What CRS returns |
|---|---|---|
| Customer A (big order) | P08 Priya Venkatesan | 690 / 690 / 690, one unsatisfied judgment ($12,300), one unreleased state tax lien ($7,450) |
| Customer D (steady order) | P17 Elena Castellanos | TransUnion 760, Equifax no-hit, Experian 700 with a collection |
| Supplier C (materials) | P01 Margaret Okafor | 790 across bureaus, clean |
| Supplier E (components) | P07 Marcus Bellamy | 560 across bureaus, active Chapter 13 |

Other selectable owners: P19 (cafe owner, 770) and P15 (TransUnion frozen).

Notes that matter when reading the numbers:

- Bureau score **models differ**; the response `modelName` is shown next to each score.
- A bureau that returns no file or no score is **not treated as clean**; it raises the risk estimate.
- HTTP 200 is not trusted by itself: `errorMessages` are surfaced as errors.
- Credentials stay on the server. The browser only calls `/api/netflow/evidence`.

## What you can do in the app

1. **Scroll story.** The 3D scene pins to the screen and page scroll runs 120 days. Bars for B's
   cash rise and fall (red below $0); pillars show money flowing with each partner, with the part
   assumed to arrive late.
2. **Tune terms.** Every slider re-runs the simulation.
3. **Read the outcome.** Expected profit (and worst 5%), cash-gap probability, probability the
   credit line is exhausted, extra funds needed in 95% of futures, and the expected amount B
   fails to pay suppliers on the due date (cascade).
4. **Search for terms.** Give limits (minimum profit, maximum line-exhausted odds, extra funds
   you can add). The app searches order size, prepayment, discount, due days and installments,
   returns the best feasible options, or the closest ones and which limit they break.
5. **Check the evidence.** Per-partner bureau table with RequestIDs and public-record counts.

The page has an EN / 한국어 toggle.

## Run it

Requirements: Node 22+, CRS sandbox credentials (from the CRS team, see their onboarding email).

```bash
npm install
cp .env.example .env.local   # then fill in CRS_USERNAME and CRS_PASSWORD
npm run dev                  # http://localhost:3000/netflow
```

For a stable demo (no dev-server hot reload), use:

```bash
npm run build && npm start
```

Tests (simulator and search):

```bash
npm test
```

If the CRS login fails once, the server will not retry it (repeated failures can lock the
account). Fix the credentials and restart.

## Project layout

```
app/netflow/            page, 3D scene (three.js), layout
app/api/netflow/evidence/   server route: 3 bureaus + PitchPoint for one persona
lib/crs/                CRS client (token reuse, errorMessages, RequestID) and persona request bodies
lib/netflow/evidence.ts   turns raw CRS responses into plain evidence
lib/netflow/risk.ts       evidence -> late/default odds (illustrative)
lib/netflow/sim.ts        Monte Carlo cash-flow simulation
lib/netflow/search.ts     constraint search over terms
lib/netflow/i18n.ts       EN / KO strings
```

Persona request bodies are copied from the CRS MCP test data unchanged, because the sandbox only
returns canned responses when the body matches exactly.

## How the simulation works

- Days 0-120. Customers pay on their terms; each payment is on time, late (exponential delay), or
  defaulted (only the recovered share arrives).
- Late suppliers delay B's delivery, which shifts B's receipts.
- B pays suppliers on their due dates. Shortfalls are covered by the emergency credit line (with
  interest); anything beyond the line is unpaid to suppliers, which is the cascade metric.
- Money is whole dollars. Results are deterministic for a given seed.

## Limitations and responsible use

- Owner credit is a proxy for a small business's payment behavior. It is an assumption, not a
  finding about any real company.
- The risk mapping is not calibrated to real default data.
- This tool does not approve or decline credit and does not decide fraud. It is for exploring
  trade terms.
- A production version handling real consumers would need a permissible purpose and consent under
  FCRA; the sandbox data here is all fake.
