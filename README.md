# Cortellis MCP Server

MCP Server for searching drugs and exploring ontology terms in the Cortellis database.

## Tools

1. `search_drugs`
   - Search for drugs in the Cortellis database
   - Optional Inputs:
     - `query` (string) - Raw search query
     - `company` (string) - Company developing the drug
     - `indication` (string) - Active indications (e.g., obesity)
     - `action` (string) - Target specific action (e.g., glucagon)
     - `phase` (string) - Development status:
       - Supports both short and descriptive formats:
         - Short format: S, DR, CU, C1-C3, PR, R, L, OL, NDR, DX, W
         - Descriptive format: "Phase 1 Clinical", "Phase 2 Clinical", "Phase 3 Clinical", "Launched", etc.
       - Supports OR/AND operators: "C2 OR C3" or "Phase 2 Clinical OR Phase 3 Clinical"
       - Examples:
         - `phase: "C3"` (short format)
         - `phase: "C2 OR C3"` (short format)
         - `phase: "Phase 2 Clinical OR Phase 3 Clinical"` (descriptive format)
         - `phase: "C2 AND C3"` (using AND operator)
       - Status codes:
         - S: Suspended
         - DR: Discovery/Preclinical
         - CU: Clinical (unknown phase)
         - C1-C3: Phase 1-3 Clinical
         - PR: Pre-registration
         - R: Registered
         - L: Launched
         - OL: Outlicensed
         - NDR: No Development Reported
         - DX: Discontinued
         - W: Withdrawn
     - `phase_terminated` (string) - Last phase before NDR/DX
       - Supports same formats and operators as `phase`
       - Examples:
         - `phase_terminated: "C2 OR CR"` (short format)
         - `phase_terminated: "C2"` (short format)
         - `phase_terminated: "Phase 2 Clinical"` (descriptive format)
         - `phase_terminated: "C2 OR C3"` (multiple phases)
     - `technology` (string) - Drug technology (e.g., small molecule)
     - `drug_name` (string) - Name of the drug
     - `country` (string) - Country of development
     - `offset` (number) - For pagination
   - Returns: JSON response with drug information and development status

2. `explore_ontology`
   - Explore taxonomy terms in the Cortellis database
   - Optional Inputs (at least one required):
     - `term` (string) - Generic search term
     - `category` (string) - Category to search within
     - `action` (string) - Target specific action
     - `indication` (string) - Disease/condition
     - `company` (string) - Company name
     - `drug_name` (string) - Drug name
     - `target` (string) - Drug target
     - `technology` (string) - Drug technology
   - Returns: JSON response with matching taxonomy terms

3. `get_drug`
   - Return the entire drug record with all available fields for a given identifier
   - Required Input:
     - `id` (string) - Drug Identifier
   - Returns: JSON response with complete drug record

4. `get_drug_swot`
   - Return SWOT analysis complementing chosen drug record
   - Required Input:
     - `id` (string) - Drug Identifier
   - Returns: JSON response with SWOT analysis for the drug

5. `get_drug_financial`
   - Return financial commentary and data (actual sales and consensus forecast)
   - Required Input:
     - `id` (string) - Drug Identifier
   - Returns: JSON response with financial data and commentary

6. `get_company`
   - Return the entire company record with all available fields for a given identifier
   - Required Input:
     - `id` (string) - Company Identifier
   - Returns: JSON response with complete company record

7. `search_companies`
   - Search for companies in the Cortellis database
   - Optional Inputs:
     - `query` (string) - Raw search query
     - `company_name` (string) - Company name to search for
     - `hq_country` (string) - Company headquarters country
     - `deals_count` (string) - Count for all distinct deals where company is principal/partner
       - Format: '<20' for less than 20 deals
       - Format: '20' or '>20' for greater than 20 deals (default behavior)
     - `indications` (string) - Top 10 indication terms
     - `actions` (string) - Top 10 target-based action terms
     - `technologies` (string) - Top 10 technologies terms
     - `company_size` (string) - The size of a company based on market capitalization in billions USD
       - Format: '<2' for less than $2B
       - Format: '2' or '>2' for greater than $2B (default behavior)
     - `status` (string) - Highest status of linked drugs
     - `offset` (number) - For pagination
   - Returns: JSON response with company information

## Features

- Direct access to Cortellis drug database
- Comprehensive drug development status search
- Ontology/taxonomy term exploration
- Detailed drug information retrieval
- SWOT analysis for drugs
- Financial data and forecasts
- Structured JSON responses
- Pagination support for large result sets

## HTTP API Endpoints

When running in HTTP mode (USE_HTTP=true), the following REST endpoints are available:

1. `POST /search_drugs`
   - Search for drugs with optional filters
   - Body: JSON object with search parameters (see `search_drugs` tool inputs)

2. `POST /explore_ontology`
   - Search taxonomy terms
   - Body: JSON object with search parameters (see `explore_ontology` tool inputs)

3. `GET /drug/:id`
   - Get complete drug record by ID
   - Parameters:
     - `id`: Drug identifier

4. `GET /drug/:id/swot`
   - Get SWOT analysis for a drug
   - Parameters:
     - `id`: Drug identifier

5. `GET /drug/:id/financial`
   - Get financial data and forecasts for a drug
   - Parameters:
     - `id`: Drug identifier

6. `GET /company/:id`
   - Get complete company record by ID
   - Parameters:
     - `id`: Company identifier

7. `POST /search_companies`
   - Search for companies with optional filters
   - Body: JSON object with search parameters (see `search_companies` tool inputs)

## Setup

### Environment Variables
The server requires Cortellis API credentials:

```env
CORTELLIS_USERNAME=your_username
CORTELLIS_PASSWORD=your_password
```

### Installing on Claude Desktop
Before starting make sure [Node.js](https://nodejs.org/) is installed on your desktop for `npx` to work.
1. Go to: Settings > Developer > Edit Config

2. Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cortellis": {
      "command": "npx",
      "args": [
        "-y",
        "@uh-joan/mcp-server-cortellis"
      ],
      "env": {
        "CORTELLIS_USERNAME": "your_username",
        "CORTELLIS_PASSWORD": "your_password"
      }
    }
  }
}
```

3. Restart Claude Desktop and start exploring drug development data!

## Build (for devs)

```bash
npm install
npm run build
```

For local development, create a `.env` file with your credentials:
```bash
cp .env.example .env
# Edit .env with your credentials
npm run start
```

## Docker

```bash
docker build -t mcp-server-cortellis .
docker run -i --env-file .env mcp-server-cortellis
```

## License

This MCP server is licensed under the MIT License.

## Disclaimer

Cortellis™ is a commercial product and trademark of Clarivate Analytics. This MCP server requires valid Cortellis API credentials to function. To obtain credentials and learn more about Cortellis, please visit [Clarivate's Cortellis page](https://clarivate.com/products/cortellis/). 

This project is not affiliated with, endorsed by, or sponsored by Clarivate Analytics. All product names, logos, and brands are property of their respective owners.
