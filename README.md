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

## Features

- Direct access to Cortellis drug database
- Comprehensive drug development status search
- Ontology/taxonomy term exploration
- Structured JSON responses
- Pagination support for large result sets

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
