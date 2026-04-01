# BOP 40 Accounting Data Pipeline — Complete Documentation

## What This Is

A multi-language data pipeline that extracts accounting data from OFA GL Ledgers
in FAST Redshift, compares it against trial balances, and produces the BOP 40
financial report (Balance Sheet, Profit & Loss, Equity, Assets, Liabilities)
for 5 geographies. The pipeline is integrated with the build platform's
Package Registry, Pipeline Engine, and approval workflow.

## The 5 Geos

| Geo Code | Region        | Currency |
|----------|---------------|----------|
| US       | United States | USD      |
| EU       | Europe        | EUR      |
| JP       | Japan         | JPY      |
| IN       | India         | INR      |
| BR       | Brazil        | BRL      |

## Pipeline Overview

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Extract     │    │  Compare     │    │  Approval    │    │  Report      │    │  Validate    │
│  (C++)       │───►│  (Java)      │───►│  Gate        │───►│  (Python)    │───►│  (Scala)     │
│              │    │              │    │              │    │              │    │              │
│ FAST Redshift│    │ TB vs Regs   │    │ Finance      │    │ Excel Gen    │    │ Cross-Geo    │
│ Recursive    │    │ BOP Sections │    │ Review       │    │ 5 Geos       │    │ Validation   │
│ Rollup CTEs  │    │ BS/PL/Equity │    │              │    │ Styled       │    │ BS Equation  │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
      │                    │                                       │                    │
      ▼                    ▼                                       ▼                    ▼
 5 Frames             2 Frames                                 1 Frame             1 Frame
 per geo              per geo                                  (workbook)          (results)
```


## Data Frames

Frames are the unit of data exchange between pipeline stages. Each frame is
produced by one stage and consumed by downstream stages.

| Frame Name          | Produced By   | Consumed By        | Description                                    |
|---------------------|---------------|--------------------|------------------------------------------------|
| `rollup_accounts`   | Extract (C++) | Compare (Java)     | Account hierarchy with parent-child rollups     |
| `gl_transactions`   | Extract (C++) | (archive)          | Raw GL transaction journal entries              |
| `ledgers`           | Extract (C++) | (archive)          | Ledger metadata (GL/SL, status, fiscal year)    |
| `registers`         | Extract (C++) | Compare (Java)     | Period balance registers (debit/credit/YTD)     |
| `tb_ledgers`        | Extract (C++) | Compare (Java)     | Trial balance per account (aggregated)          |
| `comparison_results`| Compare (Java)| Validate (Scala)   | Per-account variance: GL balance vs register    |
| `bop40_sections`    | Compare (Java)| Report (Python), Validate (Scala) | 5 financial sections per geo |
| `bop40_excel`       | Report (Python)| (final output)    | Multi-sheet Excel workbook                      |
| `validation_results`| Validate (Scala)| (final output)   | Cross-geo validation pass/fail per check        |

---

## OFA Source Tables (FAST Redshift)

The C++ extractor queries these tables in the `ofa_gl` schema:

| Table              | Description                                      |
|--------------------|--------------------------------------------------|
| `gl_accounts`      | Chart of accounts with parent_account_id for rollup hierarchy |
| `gl_transactions`  | Journal entries: debit/credit per account per period |
| `gl_ledgers`       | Ledger metadata: type (GL/SL), status, fiscal year |
| `gl_registers`     | Period balance registers: period and YTD debit/credit |

---

## Recursive Rollup Queries

The core of the extraction is the recursive CTE that resolves the account
hierarchy. OFA stores accounts in a parent-child tree. The rollup query
walks from root accounts (no parent) down to leaf accounts, tracking the
depth level and building a hierarchy path.

```sql
WITH RECURSIVE account_tree AS (
  -- Base case: root accounts (no parent)
  SELECT
    a.account_id,
    a.account_name,
    a.account_type,
    a.parent_account_id,
    0 AS level,
    a.account_id AS root_id,
    a.account_name AS root_name,
    CAST(a.account_name AS VARCHAR(4000)) AS hierarchy_path
  FROM ofa_gl.gl_accounts a
  WHERE a.parent_account_id IS NULL
    AND a.geo_code = 'US'

  UNION ALL

  -- Recursive case: child accounts
  SELECT
    c.account_id,
    c.account_name,
    c.account_type,
    c.parent_account_id,
    p.level + 1,
    p.root_id,
    p.root_name,
    p.hierarchy_path || ' > ' || c.account_name
  FROM ofa_gl.gl_accounts c
  INNER JOIN account_tree p ON c.parent_account_id = p.account_id
  WHERE c.geo_code = 'US'
)
SELECT * FROM account_tree
ORDER BY root_id, level, account_id;
```

A second recursive query aggregates balances from leaf accounts up through
the hierarchy, producing rolled-up debit/credit totals at every level.

---

## Package 1: C++ OFA Extractor (`ofa-extractor-cpp`)

**Language:** C++17 | **Build:** CMake | **Location:** `packages/ofa-extractor-cpp/`

### Purpose

Connects to the FAST Redshift account and extracts all OFA GL data needed for
the BOP 40 report. Runs the recursive rollup queries and produces 5 frames
per geo.

### Components

```
include/ofa_extractor/
├── types.h                 # Domain types: GLAccount, GLTransaction, LedgerEntry,
│                           #   RegisterEntry, TrialBalanceRow, RollupNode
├── redshift_client.h       # Redshift connection and query execution
├── rollup_query_builder.h  # Builds all 6 SQL queries (recursive CTEs)
├── gl_extractor.h          # Orchestrates extraction for a single geo
└── frame_registry.h        # Stores extracted frames keyed by geo:period:name

src/
├── redshift_client.cpp     # AWS Redshift Data API client
├── rollup_query_builder.cpp # SQL generation (recursive CTEs, joins, aggregations)
├── gl_extractor.cpp        # Per-geo extraction + rollup tree builder
├── frame_registry.cpp      # Frame storage and lookup
└── main.cpp                # CLI: extracts all 5 geos for a period
```

### Code Flow

```
main(period, fiscal_year)
  │
  ├── Create RedshiftClient → connect to FAST Redshift cluster
  ├── Create GLExtractor(client, "ofa_gl")
  │
  └── For each geo in [US, EU, JP, IN, BR]:
        │
        ├── extract_rollup_accounts(geo)
        │     └── RollupQueryBuilder.build_rollup_hierarchy_query(geo)
        │         → Recursive CTE → returns flat list of GLAccount with levels
        │
        ├── extract_transactions(geo, period)
        │     └── build_gl_transactions_query → SELECT from gl_transactions
        │
        ├── extract_ledgers(geo, fiscal_year)
        │     └── build_ledger_query → SELECT from gl_ledgers
        │
        ├── extract_registers(geo, period)
        │     └── build_register_query → JOIN gl_registers + gl_ledgers
        │
        ├── extract_trial_balance(geo, period)
        │     └── build_trial_balance_query → GROUP BY account, SUM debit/credit
        │
        ├── build_rollup_tree(accounts, trial_balance)
        │     └── Recursive in-memory tree: parent→children, aggregate balances
        │         from leaves to root
        │
        └── Register 5 frames in FrameRegistry:
              rollup_accounts, gl_transactions, ledgers, registers, tb_ledgers
```

### Build & Test

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

### Key Types

```cpp
struct GLAccount {
    string account_id, account_name, account_type;
    string parent_account_id;  // NULL for root accounts
    int level;                 // 0 = root, 1 = first child, etc.
    string geo_code;           // US, EU, JP, IN, BR
};

struct RollupNode {
    GLAccount account;
    vector<RollupNode> children;
    double rolled_up_debit;    // own + all descendants
    double rolled_up_credit;
    double rolled_up_net;
};
```

---

## Package 2: Java TB Comparator (`tb-comparator-java`)

**Language:** Java 17 | **Build:** Maven | **Location:** `packages/tb-comparator-java/`

### Purpose

Consumes the `rollup_accounts`, `tb_ledgers`, and `registers` frames from the
C++ extractor. Compares GL trial balance against register balances to detect
variances. Then groups accounts into the 5 BOP 40 financial statement sections
and computes totals.

### Components

```
src/main/java/com/amzn/accounting/
├── model/
│   ├── AccountType.java          # Enum: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
│   │                             #   getBopSection() → which report section
│   │                             #   getNormalBalance() → DEBIT or CREDIT
│   ├── TrialBalanceEntry.java    # Record: one account's debit/credit for a period
│   ├── ComparisonResult.java     # Record: TB vs register comparison with variances
│   ├── BopSection.java           # Record: one section (e.g., Assets) with line items
│   └── Bop40Report.java          # Record: complete report for one geo
│
└── comparator/
    ├── TrialBalanceComparator.java  # Compares GL TB vs register balances
    └── Bop40ReportBuilder.java     # Builds all 5 sections, validates BS equation
```

### Code Flow

```
TrialBalanceComparator.compare(glTrialBalance, registerBalances, geo, period)
  │
  ├── For each TB entry:
  │     ├── Accumulate totalDebits, totalCredits
  │     ├── Look up register balance for same account
  │     ├── Compute variance = |glBalance - registerBalance|
  │     └── Flag if variance > 0.01 (tolerance)
  │
  └── Return ComparisonResult:
        balanced: totalDebits - totalCredits < 0.01
        accountVariances: per-account variance list

Bop40ReportBuilder.buildReport(trialBalance, geo, period, fiscalYear)
  │
  ├── Group TB entries by AccountType
  │
  ├── Build 5 BopSections:
  │     Assets      ← AccountType.ASSET entries
  │     Liabilities ← AccountType.LIABILITY entries
  │     Equity      ← AccountType.EQUITY entries
  │     Revenue     ← AccountType.REVENUE entries
  │     Expenses    ← AccountType.EXPENSE entries
  │
  ├── Each section:
  │     ├── Map entries to BopLineItem (using normalBalance convention)
  │     ├── Sum to get sectionTotal
  │     └── Append "Total {Section}" rollup line
  │
  ├── Compute derived totals:
  │     netIncome = revenue.total - expenses.total
  │     balanceSheetCheck = assets.total - (liabilities.total + equity.total)
  │
  └── Return Bop40Report

buildAllGeoReports(trialBalanceByGeo, period, fiscalYear)
  └── For each geo in [US, EU, JP, IN, BR]:
        buildReport(tbForGeo, geo, period, fiscalYear)
```

### Normal Balance Convention

| Account Type | Normal Side | Meaning                                    |
|-------------|-------------|--------------------------------------------|
| ASSET       | DEBIT       | Positive net = debit > credit (expected)   |
| EXPENSE     | DEBIT       | Positive net = debit > credit (expected)   |
| LIABILITY   | CREDIT      | Positive net = credit > debit (expected)   |
| EQUITY      | CREDIT      | Positive net = credit > debit (expected)   |
| REVENUE     | CREDIT      | Positive net = credit > debit (expected)   |

The `normalBalance()` method returns the balance as a positive number when
the account is on its expected side. This is what appears in the BOP 40 report.

### Build & Test

```bash
mvn compile
mvn test
mvn package -DskipTests
```

---

## Package 3: Python BOP 40 Report Generator (`bop40-report-python`)

**Language:** Python 3.10+ | **Build:** pip/pyproject.toml | **Location:** `packages/bop40-report-python/`

### Purpose

Consumes the `bop40_sections` frame from the Java comparator and generates
a styled Excel workbook with one sheet per geo plus a cross-geo summary sheet.

### Components

```
bop40_report/
├── __init__.py
├── models.py          # Domain models: TrialBalanceEntry, BopSection, Bop40Report
├── excel_writer.py    # Bop40ExcelWriter — generates .xlsx with openpyxl
└── cli.py             # CLI entry point + sample data generator

tests/
├── test_models.py     # Model unit tests
└── test_excel_writer.py # Excel generation tests
```

### Excel Workbook Structure

```
bop40_report_2026-03.xlsx
│
├── Sheet: "Summary"
│   ┌─────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│   │ Metric              │ US (USD) │ EU (EUR) │ JP (JPY) │ IN (INR) │ BR (BRL) │
│   ├─────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│   │ Total Assets        │ 1.1M     │ 1.01M    │ 165M     │ 91.3M    │ 5.5M     │
│   │ Total Liabilities   │ 650K     │ 598K     │ 97.5M    │ 53.9M    │ 3.25M    │
│   │ Total Equity        │ 450K     │ 414K     │ 67.5M    │ 37.3M    │ 2.25M    │
│   │ Net Income          │ 300K     │ 276K     │ 45M      │ 24.9M    │ 1.5M     │
│   │ BS Check (A-L-E)    │ 0.00     │ 0.00     │ 0.00     │ 0.00     │ 0.00     │
│   └─────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
│   (Red highlight on BS Check if non-zero)
│
├── Sheet: "US (USD)"
│   ┌─────────────────────────────────────────────────────┐
│   │ BOP 40 — US | 2026-03 | USD                        │  (blue header)
│   ├─────────┬───────────────────────┬───────────────────┤
│   │ Assets                          │ Amount            │  (blue section header)
│   │ 1100    │ Cash & Equivalents    │ 500,000.00        │
│   │ 1200    │ Accounts Receivable   │ 350,000.00        │
│   │ 1300    │ Inventory             │ 200,000.00        │
│   │ 1400    │ Prepaid Expenses      │  50,000.00        │
│   │         │ Total Assets          │ 1,100,000.00      │  (green total, double border)
│   ├─────────┴───────────────────────┴───────────────────┤
│   │ Liabilities                     │ Amount            │
│   │ ...                                                 │
│   ├─────────────────────────────────────────────────────┤
│   │ Equity                          │ Amount            │
│   │ ...                                                 │
│   ├─────────────────────────────────────────────────────┤
│   │ Revenue                         │ Amount            │
│   │ ...                                                 │
│   ├─────────────────────────────────────────────────────┤
│   │ Expenses                        │ Amount            │
│   │ ...                                                 │
│   ├─────────────────────────────────────────────────────┤
│   │ Balance Sheet Check (A - L - E) │ 0.00              │  (green if 0, red if not)
│   └─────────────────────────────────────────────────────┘
│
├── Sheet: "EU (EUR)"
├── Sheet: "JP (JPY)"
├── Sheet: "IN (INR)"
└── Sheet: "BR (BRL)"
```

### Styling

- Header: white text on dark blue (#1F4E79)
- Section headers: dark blue text on light blue (#D6E4F0)
- Totals: bold on light green (#E2EFDA) with double-line border
- Alerts: red background (#FCE4EC) for non-zero balance sheet check
- All amounts: `#,##0.00` format

### Build & Test

```bash
pip install -e .[dev]
pytest tests/ -v
python -m bop40_report.cli 2026-03 2026 output.xlsx
```

---

## Package 4: Scala Pipeline Orchestrator (`pipeline-orchestrator-scala`)

**Language:** Scala 3.3 | **Build:** sbt | **Location:** `packages/pipeline-orchestrator-scala/`

### Purpose

Defines the pipeline structure, orchestrates execution of all 4 stages,
validates frame dependencies between stages, and runs cross-geo validation
checks on the final output.

### Components

```
src/main/scala/com/amzn/pipeline/
├── model/Types.scala                    # Domain types: PipelineStage, Bop40Pipeline,
│                                        #   FrameMetadata, PipelineResult, Geos
├── orchestrator/
│   ├── Bop40PipelineBuilder.scala       # Builds the 4-stage pipeline definition
│   ├── PipelineExecutor.scala           # Executes stages in order, validates frames
│   └── FrameStore.scala                 # In-memory frame metadata store
├── validator/Bop40Validator.scala       # Cross-geo validation checks
└── Main.scala                           # CLI entry point
```

### Pipeline Execution Flow

```
Main(period, fiscalYear)
  │
  ├── Bop40PipelineBuilder.build(period, fiscalYear)
  │     → Creates Bop40Pipeline with 4 stages
  │
  ├── PipelineExecutor.execute(pipeline)
  │     │
  │     ├── For each stage (sequential):
  │     │     │
  │     │     ├── Validate: all inputFrames exist in FrameStore
  │     │     │     → FAIL if any missing (halt pipeline)
  │     │     │
  │     │     ├── Execute: shell out to stage command
  │     │     │     For each geo in stage.geos:
  │     │     │       For each outputFrame:
  │     │     │         Register FrameMetadata in FrameStore
  │     │     │
  │     │     └── Record StageResult (status, duration, frames produced)
  │     │
  │     ├── If any stage fails → mark remaining as Skipped
  │     │
  │     └── Return PipelineResult
  │
  └── Print results
```

### Cross-Geo Validation Checks

The `Bop40Validator` runs 4 checks per geo (20 total):

| Check                  | Rule                                              | Fail Condition                    |
|------------------------|----------------------------------------------------|-----------------------------------|
| Data Completeness      | Geo must have data in the pipeline                 | Geo missing from data set         |
| Balance Sheet Equation | Assets - Liabilities - Equity = 0                  | Absolute variance > 0.01         |
| Trial Balance          | Total debits = Total credits                       | TB not balanced                   |
| Currency Consistency   | Geo uses its expected currency                     | Unknown geo code                  |

### Build & Test

```bash
sbt compile
sbt test
sbt "run 2026-03 2026"
```

---

## Build Platform Integration

All 4 packages are registered with the platform's `PackageRegistry` and
connected to the `PipelineEngine` with a full pipeline definition.

### Package Dependency Chain

```
ofa-extractor-cpp (C++)          ← no dependencies (root)
    │
    ▼
tb-comparator-java (Java)        ← depends on ofa-extractor-cpp
    │
    ▼
bop40-report-python (Python)     ← depends on tb-comparator-java
    │
    ▼
pipeline-orchestrator-scala (Scala) ← depends on all three above
```

### Package Registration

Each package is registered with its language-specific build steps:

| Package                      | Build Steps                                          |
|------------------------------|------------------------------------------------------|
| `ofa-extractor-cpp`          | cmake configure → cmake build → ctest                |
| `tb-comparator-java`         | mvn compile → mvn test → mvn package                 |
| `bop40-report-python`        | pip install → pytest → python -m build               |
| `pipeline-orchestrator-scala`| sbt compile → sbt test → sbt package                 |

### Pipeline Definition in Pipeline Engine

The BOP 40 pipeline is registered as `bop40-pipeline` with 5 stages
(4 execution stages + 1 approval gate):

```
Stage 1: "Extract (C++)"
  Steps: Build OFA Extractor → Extract GL Data
  Output artifacts: rollup_accounts, gl_transactions, tb_ledgers

Stage 2: "Compare (Java)"
  Steps: Build TB Comparator → Run TB Comparison → Unit Tests
  Input artifacts: rollup_accounts, tb_ledgers
  Output artifacts: comparison_results, bop40_sections

Stage 3: "Approval Gate"
  Steps: Finance Review (manual approval)
  Message: "TB comparison complete for all 5 geos. Please review
            variances before generating the BOP 40 Excel report."

Stage 4: "Report (Python)"
  Steps: Install Dependencies → Generate Excel → Report Tests
  Input artifacts: bop40_sections
  Output artifacts: bop40_excel

Stage 5: "Validate (Scala)"
  Steps: Cross-Geo Validation → Scala Tests
  Input artifacts: bop40_sections, comparison_results
  Output artifacts: validation_results
```

### Trigger Configuration

```
Repository: bop40-accounting
Branch: main
Parallel runs: disabled
```

A push to `main` on the `bop40-accounting` repo auto-triggers the pipeline.

---

## Approval Workflow

The pipeline pauses after the Compare stage and before the Report stage.
This is the "Finance Review" approval gate.

### Why an Approval Gate Here

The Compare stage produces variance data between the GL trial balance and
register balances. Before generating the final Excel report (which goes to
finance stakeholders), a human reviewer should:

1. Check that all 5 geos have data
2. Review any account-level variances flagged by the comparator
3. Confirm the trial balance is balanced for each geo
4. Approve or reject the pipeline

### How It Works

1. Pipeline runs stages 1 and 2 automatically
2. At stage 3, the `CallbackApprovalProvider` creates a pending approval
3. The pipeline executor `await`s a Promise that blocks until resolved
4. The dashboard shows an orange approval banner with the message
5. The reviewer clicks Approve or Reject
6. If approved: stages 4 and 5 execute
7. If rejected: pipeline fails, stages 4 and 5 are skipped

### API Endpoints

```
GET  /api/approvals                    → list pending approvals
POST /api/approvals/approve            → { runId, stageName, stepName, approvedBy }
POST /api/approvals/reject             → { runId, stageName, stepName, rejectedBy }
```

---

## Dashboard UI

The pipeline is visible in the web dashboard at `http://localhost:3000`.

### Running the Dashboard

```bash
npm run ui
```

The BOP 40 pipeline appears as "BOP 40 Accounting Report Pipeline" with
5 stage cards connected by arrows. Click "Run" to trigger it. The pipeline
will pause at the Approval Gate stage, showing an orange banner with
Approve/Reject buttons.

### What You See

- Stage cards show the language-specific steps (Build, Extract, Compare, etc.)
- Artifact tags show frame flow between stages (blue = input, green = output)
- The approval banner shows the finance review message
- Auto-refreshes every 2 seconds to show real-time progress

---

## End-to-End Data Flow

Here is the complete data flow from Redshift to Excel, showing what
happens at each stage for a single geo (US). The same flow runs for
all 5 geos.

```
FAST Redshift (ofa_gl schema)
│
│  ┌─────────────────────────────────────────────────────────────┐
│  │ gl_accounts table                                           │
│  │ ┌──────────┬────────────┬──────────┬───────────────────┐    │
│  │ │account_id│account_name│acct_type │parent_account_id  │    │
│  │ ├──────────┼────────────┼──────────┼───────────────────┤    │
│  │ │ 1000     │ Total      │ ASSET    │ NULL (root)       │    │
│  │ │ 1100     │ Assets     │ ASSET    │ 1000              │    │
│  │ │ 1110     │ Cash       │ ASSET    │ 1100              │    │
│  │ │ 1120     │ AR         │ ASSET    │ 1100              │    │
│  │ │ 2000     │ Liabilities│ LIABILITY│ NULL (root)       │    │
│  │ └──────────┴────────────┴──────────┴───────────────────┘    │
│  └─────────────────────────────────────────────────────────────┘
│
▼ Stage 1: Extract (C++) — Recursive CTE
│
│  WITH RECURSIVE account_tree AS (
│    SELECT ... WHERE parent_account_id IS NULL AND geo_code = 'US'
│    UNION ALL
│    SELECT ... JOIN account_tree ON parent = child
│  )
│
│  Result: flat list with levels
│  ┌──────────┬──────┬──────────┐
│  │account_id│level │hierarchy │
│  │ 1000     │ 0    │ Total    │
│  │ 1100     │ 1    │ Total > Assets │
│  │ 1110     │ 2    │ Total > Assets > Cash │
│  │ 1120     │ 2    │ Total > Assets > AR   │
│  └──────────┴──────┴──────────┘
│
│  Also extracts: gl_transactions, ledgers, registers, trial_balance
│  Builds in-memory RollupNode tree with aggregated balances
│
│  Frames produced: rollup_accounts, gl_transactions, ledgers, registers, tb_ledgers
│
▼ Stage 2: Compare (Java)
│
│  TrialBalanceComparator:
│    For each account: |GL balance - register balance| → variance
│    Flag if variance > 0.01
│
│  Bop40ReportBuilder:
│    Group by AccountType → 5 sections
│    ┌─────────────┬──────────────┬──────────┐
│    │ Section     │ Accounts     │ Total    │
│    │ Assets      │ Cash, AR     │ 150,000  │
│    │ Liabilities │ AP           │  80,000  │
│    │ Equity      │ RE           │  30,000  │
│    │ Revenue     │ Sales        │ 200,000  │
│    │ Expenses    │ COGS, OpEx   │ 160,000  │
│    └─────────────┴──────────────┴──────────┘
│    Net Income: 200,000 - 160,000 = 40,000
│    BS Check: 150,000 - 80,000 - 30,000 = 40,000 (includes retained earnings)
│
│  Frames produced: comparison_results, bop40_sections
│
▼ Stage 3: Approval Gate
│
│  Pipeline pauses. Finance reviewer checks variances.
│  Approve → continue. Reject → pipeline fails.
│
▼ Stage 4: Report (Python)
│
│  Bop40ExcelWriter:
│    Creates workbook with 6 sheets (Summary + 5 geos)
│    Applies styling: headers, section colors, currency formatting
│    Highlights BS check failures in red
│
│  Frame produced: bop40_excel (the .xlsx file)
│
▼ Stage 5: Validate (Scala)
│
│  Bop40Validator.validateAllGeos():
│    For each geo: 4 checks
│    ✓ Data Completeness
│    ✓ Balance Sheet Equation (A = L + E)
│    ✓ Trial Balance (debits = credits)
│    ✓ Currency Consistency
│
│  Frame produced: validation_results
│
▼ Pipeline Complete
```

---

## File Inventory

```
packages/
├── ofa-extractor-cpp/           # C++ — 4 headers, 5 source files, 2 test files, CMakeLists.txt
├── tb-comparator-java/          # Java — 5 model records, 2 comparator classes, 2 test classes, pom.xml
├── bop40-report-python/         # Python — 3 modules, 2 test files, pyproject.toml
└── pipeline-orchestrator-scala/ # Scala — 5 source files, 1 test spec, build.sbt

src/ui/bop40-seed.ts             # Registers all 4 packages + pipeline definition with the platform
```
