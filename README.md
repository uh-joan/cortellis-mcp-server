# Cortellis MCP Server

MCP Server for searching drugs and exploring ontology terms in the Cortellis database.

## Installation

```bash
# Using npm
npm install @uh-joan/cortellis-mcp-server
```

## Quick Start

1. Set up your environment variables:
```env
CORTELLIS_USERNAME=your_username
CORTELLIS_PASSWORD=your_password
USE_HTTP=true  # Optional: run as HTTP server
PORT=3000      # Optional: specify port for HTTP server
```

2. Run the server:
```bash
# As MCP server
npx cortellis-mcp-server

# As HTTP server
USE_HTTP=true PORT=3000 npx cortellis-mcp-server
```

## Tools

1. `search_drugs`
   - Search for drugs in the Cortellis database
   - Optional Inputs:
     - `query` (string) - Raw search query
     - `company` (string) - Company ID for the developing company (e.g., "18614")
     - `indication` (string) - Indication ID (numeric ID only, e.g., "238" for Obesity). Use explore_ontology to find the correct ID.
     - `action` (string) - Target specific action (e.g., glucagon)
     - `phase` (string) - Development status:
       - Uses LINKED format with short codes: S, DR, CU, C1-C3, PR, R, L, OL, NDR, DX, W
       - Supports OR/AND operators: "L OR C3"
       - Examples:
         - phase: "L"
         - phase: "C3 OR PR"
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
       - Uses short format with double colon: S, DR, CU, C1-C3, PR, R, L, OL, NDR, DX, W
       - Examples:
         - `phase_terminated: "C2"`
         - `phase_terminated: "C2 OR C3"`
     - `technology` (string) - Drug technology (e.g., small molecule)
     - `drug_name` (string) - Name of the drug
     - `country` (string) - Country ID (e.g., "US")
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
     - `id` (string) - Numeric Drug Identifier (e.g. "101964" for tirzepatide, not the drug name)
   - Example:
     {
       "tool-name": "get_drug",
       "Tool_Parameters": {
         "id": "101964"
       }
     }
   - Returns: JSON response with complete drug record

4. `get_drug_swot`
   - Return SWOT analysis complementing chosen drug record
   - Required Input:
     - `id` (string) - Numeric Drug Identifier (e.g. "101964" for tirzepatide, not the drug name)
   - Example:
     {
       "tool-name": "get_drug_swot",
       "Tool_Parameters": {
         "id": "101964"
       }
     }
   - Returns: JSON response with SWOT analysis for the drug

5. `get_drug_financial`
   - Return financial commentary and data (actual sales and consensus forecast)
   - Required Input:
     - `id` (string) - Numeric Drug Identifier (e.g. "101964" for tirzepatide, not the drug name)
   - Example:
     {
       "tool-name": "get_drug_financial",
       "Tool_Parameters": {
         "id": "101964"
       }
     }
   - Returns: JSON response with financial data and commentary

6. `get_company`
   - Return the entire company record with all available fields for a given identifier
   - Required Input:
     - `id` (string) - Numeric Company Identifier (not the company name)
   - Example:
     {
       "tool-name": "get_company",
       "Tool_Parameters": {
         "id": "12345"
       }
     }
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

8. `search_deals`
   - Search for deals in the Cortellis database
   - Optional Inputs:
     - `query` (string) - Raw search query (if you want to use the full Cortellis query syntax directly)
     - `dealDrugNamesAll` (string) - Main name of drug including synonyms associated with the deal
     - `indications` (string) - Indications associated with the deal
     - `dealDrugCompanyPartnerIndications` (string) - The indication and the partner company linked to a drug associated with the deal
     - `dealPhaseHighestStart` (string) - Highest dev. status of the drug at the deal start
     - `dealPhaseHighestNow` (string) - Current highest dev. status of the drug
     - `dealStatus` (string) - Status of the deal
     - `dealSummary` (string) - Summary of the deal
     - `dealTitleSummary` (string) - Title or summary of the deal
     - `technologies` (string) - Technology linked to the drug
     - `dealTitle` (string) - Title of the deal
     - `dealType` (string) - Type of deal
     - `actionsPrimary` (string) - Primary mechanism of action associated with the deal
     - `dealDrugActionsPrimary` (string) - The primary mechanism of action of a drug associated with the deal
     - `dealCompanyPrincipal` (string) - Principal company (Seller/Licensor)
     - `dealCompanyPartner` (string) - Partner company (Buyer/Licensee)
     - `dealCompanyPrincipalHq` (string) - Location of the HQ of the principal company
     - `dealTerritoriesIncluded` (string) - The deal applies in the included countries
     - `dealTerritoriesExcluded` (string) - The deal doesn't apply in the excluded countries
     - `dealDateStart` (string) - Start date of the deal
     - `dealDateEnd` (string) - End date of the deal
     - `dealDateEventMostRecent` (string) - Date of the latest timeline event
     - `dealValuePaidToPartnerMaxNumber` (string) - Maximal paid payment amount to partner company in M USD considering the accuracy range
     - `dealTotalProjectedCurrentAmount` (string) - Total current projection of the agreement in US dollars million
     - `dealValuePaidToPartnerMinNumber` (string) - Minimal paid payment amount to partner company in M USD considering the accuracy range
     - `dealTotalPaidAmount` (string) - Total payment value of the agreement realized in US dollars million
     - `dealValuePaidToPrincipalMaxDisclosureStatus` (string) - Whether the paid payment of the principal company is either 'Payment Unspecified', 'Unknown', or 'Known'
     - `dealValuePaidToPrincipalMaxNumber` (string) - Maximal paid amount to principal company in M USD considering the accuracy range
     - `dealValuePaidToPrincipalMinNumber` (string) - Minimal paid amount to principal company in M USD considering the accuracy range
     - `dealValueProjectedToPartnerMaxNumber` (string) - Maximal projected current amount to partner company in M USD considering the accuracy range
     - `dealValueProjectedToPartnerMinNumber` (string) - Minimal projected current amount to partner company in M USD considering the accuracy range
     - `dealValueProjectedToPrincipalMaxDisclosureStatus` (string) - Whether the projected current payment of the principal company is either 'Payment Unspecified', 'Unknown', or 'Known'
     - `dealValueProjectedToPrincipalMaxNumber` (string) - Maximal projected current amount to principal company in M USD considering the accuracy range
     - `dealValueProjectedToPrincipalMinNumber` (string) - Minimal projected current amount to principal company in M USD considering the accuracy range
     - `offset` (number) - For pagination
   - Returns: JSON response with deal information
   - Example:
     ```json
     {
       "dealStatus": "Completed",
       "indications": "Melanoma"
     }
     ```

## Features

- Direct access to Cortellis drug and deal database
- Comprehensive drug and deal development status search
- Ontology/taxonomy term exploration
- Detailed drug and deal information retrieval
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

8. `POST /search_deals`
   - Search for deals with optional filters
   - Body: JSON object with search parameters (see `search_deals` tool inputs)

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
        "@uh-joan/cortellis-mcp-server"
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
git clone https://github.com/uh-joan/cortellis-mcp-server.git
cd cortellis-mcp-server
npm install
npm run build
```

For local development:
```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your credentials
vim .env  # or use your preferred editor

# Start the server
npm run start
```

## Docker

```bash
docker build -t cortellis-mcp-server .
docker run -i --env-file .env cortellis-mcp-server
```

## License

This MCP server is licensed under the MIT License.

## Disclaimer

Cortellis™ is a commercial product and trademark of Clarivate Analytics. This MCP server requires valid Cortellis API credentials to function. To obtain credentials and learn more about Cortellis, please visit [Clarivate's Cortellis page](https://clarivate.com/products/cortellis/). 

This project is not affiliated with, endorsed by, or sponsored by Clarivate Analytics. All product names, logos, and brands are property of their respective owners.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/uh-joan/cortellis-mcp-server/tags).
