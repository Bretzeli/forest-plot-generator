# Forest Plot Creator

A lightweight web app to generate publication-quality forest plots from a CSV file.

## Features

- Create forest plots (CI lines + diamond markers) from a simple CSV.

### Color pickers (opacity supported)
- Diamond marker fill color 
- CI/line color
- Vertical reference axis color

### Toggleable options
- Mirror x-axis (flip labels so high → low)
- Treat effects as ratios (log scale on x-axis for OR/RR/HR)
- Show/hide grid lines

### Other features
- Fullscreen plot view
- Download as PNG

## View the website
- Hosted at: https://www.forest-plot.brezeli.de

## Frameworks & libraries used
- Next.js (React)
- React (v19)
- Plotly 
- PapaParse
- Tailwind CSS
- shadcn/ui 

## CSV format

The app expects a CSV file with one row per study. Rows that include only a study name (no numeric fields) will be rendered as subheaders in the table and plot.

### Important notes about the CSV
- Rows that contain only a `study` value and no numeric columns will be retained and displayed as subheaders to group or label sections.
- If `weight` is omitted the app will estimate weights from CI width (or log CI width when using ratio/log mode).
- The header ror must not contain any spaces, this restriction applies to all supported column names and aliases but not to data rows.
- Header names are case-sensitive

### Supported columns (names and aliases)

| Column | Aliases | Meaning | Type | Example(s)                | Meaning                                                                                  |
|---|---|---|---|---------------------------|------------------------------------------------------------------------------------------|
| `study` | `Study`, `name`, `Name`, `Studie` | Study label shown on the left-hand table and y-axis tick label | string | `Smith 2021`, `Subgroup A` | Rows with only a study and no numeric fields are treated as subheaders                   |
| `effect` | `Effect`, `or`, `OR`, `value`, `ES` | Point estimate for the study (e.g., odds ratio, mean difference) | numeric | `1.25`, `0.85`            | For ratio measures (OR/RR/HR), enable "Treat effects as ratios" to pool on the log scale |
| `ci_low` | `CI_low`, `ciLower`, `lower`, `Lower`, `Untere_KI`, `untere_KI`, `untere_ki` | Lower bound of the 95% confidence interval | numeric | `0.95`, `-1.2`            |                                              |
| `ci_high` | `CI_high`, `ciUpper`, `upper`, `Upper`, `Obere_KI`, `obere_KI`, `obere_ki` | Upper bound of the 95% confidence interval | numeric | `1.65`, `2.3`             |                                             |
| `weight` | `Weight` | Optional numeric weight to use for marker sizing and pooled-weight calculations | numeric | `12.5`                    | If omitted, weight is estimated from CI width (or log CI width in ratio/log mode)        |

## Example CSV (comma-separated)

Save as `example.csv` and upload via the app UI.

```
study,effect,ci_low,ci_high,weight
"Subgroup A",,,,
"Smith 2021",1.25,0.95,1.65,12.5
"Jones 2020",0.82,0.60,1.12
"Lee 2019",1.10,0.90,1.33,8
"Subgroup B",,,,
"Garcia 2022",0.95,0.70,1.28
```

The blank numeric cells under the subgroup rows show how simple subheaders are represented (the app keeps the row because `study` is present).

## How to run locally

### Prerequisites
- Node.js (recommended 18+)
- npm (or a compatible package manager)

### Install and run

1. Install dependencies:

```bash
npm install
```

2. Run the dev server:

```bash
npm run dev
```

3. Open the app in your browser:

- http://localhost:3000

### Build for production

```bash
npm run build
npm start
```

## Troubleshooting
- Use the app on a desktop or laptop for the best experience; mobile support is very limited.
- If CSV parsing fails, ensure the file is valid UTF-8 and that headers are present. The parser is case-insensitive for supported aliases.
