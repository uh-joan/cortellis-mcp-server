#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { cleanObject } from "./util.js";
import fetch from 'node-fetch';
import express, { Request, Response } from 'express';
import 'dotenv/config';
import { createHash } from 'crypto';
import request from 'request';
import { promisify } from 'util';

// API credentials from environment variables
const USERNAME = process.env.CORTELLIS_USERNAME || '';
const PASSWORD = process.env.CORTELLIS_PASSWORD || '';
const USE_HTTP = process.env.USE_HTTP === 'true';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

if (!USERNAME || !PASSWORD) {
  console.error("Error: CORTELLIS_USERNAME and CORTELLIS_PASSWORD environment variables must be set");
  process.exit(1);
}

// Tool definitions
const SEARCH_DRUGS_TOOL: Tool = {
  name: "search_drugs",
  description: "Search for drugs in the Cortellis database. If the amount of drugs returned do not match with the totalResults, ALWAYS use the offset parameter to get the next page(s) of results.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Raw search query (if you want to use the full Cortellis query syntax directly)"
      },
      company: {
        type: "string",
        description: "Company developing the drug (Active companies)"
      },
      indication: {
        type: "string",
        description: "Active indications of a drug (e.g. obesity or cancer)"
      },
      action: {
        type: "string",
        description: "Target specific action (e.g. glucagon)"
      },
      phase: {
        type: "string",
        description: "Overall Highest development status of drug",
        enum: [
          "S",   // Suspended
          "DR",  // Discovery/Preclinical
          "CU",  // Clinical unknown
          "C1",  // Phase 1
          "C2",  // Phase 2
          "C3",  // Phase 3
          "PR",  // Pre-registration
          "R",   // Registered
          "L",   // Launched
          "OL",  // Outlicensed
          "NDR", // No Development Reported
          "DX",  // Discontinued
          "W"    // Withdrawn
        ],
        enumDescriptions: {
          "S": "Suspended - Development temporarily halted",
          "DR": "Discovery/Preclinical - Early stage research",
          "CU": "Clinical unknown - Clinical stage not specified",
          "C1": "Phase 1 - Initial human safety trials",
          "C2": "Phase 2 - Small scale efficacy trials",
          "C3": "Phase 3 - Large scale efficacy trials",
          "PR": "Pre-registration - Submitted for approval",
          "R": "Registered - Approved but not yet launched",
          "L": "Launched - Available in market",
          "OL": "Outlicensed - Rights transferred to another company",
          "NDR": "No Development Reported - No recent updates",
          "DX": "Discontinued - Development stopped",
          "W": "Withdrawn - Removed from market"
        },
        examples: [
          "C3",
          "C3 OR PR",
          "C1 AND C2"
        ],
        format: "Can use OR/AND operators for multiple phases"
      },
      phase_terminated: {
        type: "string",
        description: "Last phase before No Dev Reported or Discontinued statuses"
      },
      technology: {
        type: "string",
        description: "Technologies used in drug development (e.g. small molecule, biologic)"
      },
      drug_name: {
        type: "string",
        description: "Name of the drug (e.g. semaglutide)"
      },
      country: {
        type: "string",
        description: "Country of drug development (e.g. US, EU)"
      },
      offset: {
        type: "number",
        description: "Starting position in the results (default: 0)"
      },
      company_size: {
        type: "string",
        description: "The size of a company based on market capitalization in billions USD",
        format: "'<X' for less than $XB, 'X' for greater than $XB",
        examples: ["<2", "2"],
        notes: "Values are in billions USD"
      }
    }
  },
  examples: [
    {
      description: "Search for Phase 3 obesity drugs",
      usage: `{
        "phase": "C3",
        "indication": "obesity"
      }`
    },
    {
      description: "Search for drugs in Phase 3 OR Pre-registration",
      usage: `{
        "phase": "C3 OR PR"
      }`
    }
  ]
};

const EXPLORE_ONTOLOGY_TOOL: Tool = {
  name: "explore_ontology",
  description: "Explore the ontology or taxonomy terms in the Cortellis database",
  inputSchema: {
    type: "object",
    properties: {
      term: {
        type: "string",
        description: "Generic search term (used only if no specific category is provided)",
        examples: ["GLP-1", "obesity", "diabetes"]
      },
      category: {
        type: "string",
        description: "Category to search within",
        enum: [
          "action",
          "indication", 
          "company",
          "drug_name",
          "target",
          "technology"
        ],
        enumDescriptions: {
          "action": "Drug mechanism of action or molecular target",
          "indication": "Disease or condition the drug treats",
          "company": "Organizations developing drugs",
          "drug_name": "Names of drug compounds",
          "target": "Biological targets of drugs",
          "technology": "Drug development technologies and platforms"
        }
      },
      action: {
        type: "string",
        description: "Target specific action of the drug",
        examples: ["glucagon", "GLP-1", "insulin receptor agonist"]
      },
      indication: {
        type: "string",
        description: "Active indications of a drug",
        examples: ["obesity", "diabetes", "NASH"]
      },
      company: {
        type: "string",
        description: "Active companies developing drugs",
        examples: ["Novo Nordisk", "Eli Lilly", "Pfizer"]
      },
      drug_name: {
        type: "string",
        description: "Drug name to search",
        examples: ["semaglutide", "tirzepatide"]
      },
      target: {
        type: "string",
        description: "Target of the drug",
        examples: ["GLP-1 receptor", "insulin receptor"]
      },
      technology: {
        type: "string",
        description: "Technologies used in drug development",
        examples: ["small molecule", "monoclonal antibody", "peptide"]
      }
    }
  },
  examples: [
    {
      description: "Search for GLP-1 related actions",
      usage: `{
        "category": "action",
        "term": "GLP-1"
      }`
    }
  ]
};

const GET_DRUG_TOOL: Tool = {
  name: "get_drug",
  description: "Return the entire drug record with all available fields for a given identifier from Cortellis API",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Drug Identifier from Cortellis database",
        examples: ["93910", "143520"]
      }
    },
    required: ["id"]
  },
  returnSchema: {
    description: "Returns comprehensive drug information including:",
    fields: [
      "Drug synonyms and alternative names",
      "Company originator and development companies",
      "Current development status and history",
      "Primary and secondary indications",
      "Mechanism of action",
      "Technology platforms",
      "Patent information",
      "Clinical trial information",
      "Regulatory designations"
    ]
  },
  examples: [
    {
      description: "Get complete information for Cagrilintide",
      usage: `{
        "id": "93910"
      }`
    }
  ]
};

const GET_DRUG_SWOT_TOOL: Tool = {
  name: "get_drug_swot",
  description: "Return SWOT analysis complementing chosen drug record for a submitted drug identifier from Cortellis API",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Drug Identifier from Cortellis database",
        examples: ["93910", "143520"]
      }
    },
    required: ["id"]
  },
  returnSchema: {
    description: "Returns detailed SWOT analysis including:",
    fields: [
      "Strengths: Key advantages and positive attributes",
      "Weaknesses: Limitations and challenges",
      "Opportunities: Market potential and growth areas",
      "Threats: Competition and market risks"
    ]
  },
  examples: [
    {
      description: "Get SWOT analysis for a specific drug",
      usage: `{
        "id": "93910"
      }`
    }
  ]
};

const GET_DRUG_FINANCIAL_TOOL: Tool = {
  name: "get_drug_financial",
  description: "Return financial commentary and data (actual sales and consensus forecast) for a submitted drug identifier from Cortellis API",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Drug Identifier from Cortellis database",
        examples: ["93910", "143520"]
      }
    },
    required: ["id"]
  },
  returnSchema: {
    description: "Returns comprehensive financial data including:",
    fields: [
      "Historical sales data",
      "Sales forecasts and projections",
      "Market analysis and commentary",
      "Regional sales breakdown",
      "Analyst consensus estimates"
    ]
  },
  examples: [
    {
      description: "Get financial data for a specific drug",
      usage: `{
        "id": "93910"
      }`
    }
  ]
};

const GET_COMPANY_TOOL: Tool = {
  name: "get_company",
  description: "Return the entire company record with all available fields for a given identifier from Cortellis API",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Company identifier from Cortellis database",
        examples: ["12345", "67890"]
      }
    },
    required: ["id"]
  },
  returnSchema: {
    description: "Returns comprehensive company information including:",
    fields: [
      "Company overview and history",
      "Drug pipeline information",
      "Development partnerships",
      "Licensing deals",
      "Patent portfolio",
      "Financial information",
      "Key personnel",
      "Research focus areas"
    ]
  },
  examples: [
    {
      description: "Get complete company information",
      usage: `{
        "id": "12345"
      }`
    }
  ]
};

const SEARCH_COMPANIES_TOOL: Tool = {
  name: "search_companies",
  description: "Search for companies in the Cortellis database. If the amount of companies returned do not match with the totalResults, ALWAYS use the offset parameter to get the next page(s) of results.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Raw search query using Cortellis query syntax",
        examples: ["companyNameDisplay:pfizer", "companyHqCountry:US AND companyDealsCount:RANGE(>20)"]
      },
      company_name: {
        type: "string",
        description: "Company name to search for",
        examples: ["pfizer", "novartis"]
      },
      hq_country: {
        type: "string",
        description: "Company headquarters country",
        examples: ["US", "CH", "DK"],
        format: "Two-letter country code"
      },
      deals_count: {
        type: "string",
        description: "Count for all distinct deals where company is principal/partner",
        format: "'<X' for less than X deals, 'X' for greater than X deals",
        examples: ["<20", "20", ">50"]
      },
      indications: {
        type: "string",
        description: "Top 10 indication terms from company's drugs/patents",
        examples: ["diabetes", "obesity", "oncology"]
      },
      actions: {
        type: "string",
        description: "Top 10 target-based action terms from company's portfolio",
        examples: ["GLP-1", "SGLT2", "PD-1"]
      },
      technologies: {
        type: "string",
        description: "Top 10 technologies terms from company's portfolio",
        examples: ["Antibody", "Small molecule", "Cell therapy"]
      },
      company_size: {
        type: "string",
        description: "Company size based on market cap (billions USD)",
        format: "'<X' for less than $XB, 'X' for greater than $XB",
        examples: ["<2", "2", ">10"]
      },
      status: {
        type: "string",
        description: "Highest status of associated drugs",
        enum: ["launched", "phase 3", "phase 2", "phase 1", "preclinical"],
        examples: ["launched", "phase 3"]
      },
      offset: {
        type: "number",
        description: "Starting position for pagination",
        default: 0,
        examples: [0, 100, 200]
      }
    }
  },
  examples: [
    {
      description: "Search for large US companies with many deals",
      usage: `{
        "hq_country": "US",
        "company_size": "10",
        "deals_count": "50"
      }`
    },
    {
      description: "Search for companies working on GLP-1 drugs",
      usage: `{
        "actions": "GLP-1",
        "status": "phase 3"
      }`
    }
  ]
};

interface SearchParams {
  query?: string;
  company?: string;
  indication?: string;
  action?: string;
  phase?: string;
  phase_terminated?: string;
  technology?: string;
  drug_name?: string;
  country?: string;
  offset?: number;
}

interface SearchCompaniesParams {
  query?: string;
  company_name?: string;
  hq_country?: string;
  deals_count?: string;
  indications?: string;
  actions?: string;
  technologies?: string;
  company_size?: string;
  status?: string;
  offset?: number;
}

interface OntologyParams {
  term?: string;
  category?: string;
  action?: string;
  indication?: string;
  company?: string;
  drug_name?: string;
  target?: string;
  technology?: string;
}

const requestAsync = promisify(request);

function createMcpError(message: string, code: number = -32603): McpError {
  return new McpError(code, message);
}

async function digestAuth(url: string, method: string = 'GET') {
  try {
    console.log(`Making request to: ${url}`);
    
    // First request to get the WWW-Authenticate header
    const initialResponse = await fetch(url);
    const wwwAuth = initialResponse.headers.get('www-authenticate');
    if (!wwwAuth) {
      throw new Error('No WWW-Authenticate header received');
    }

    // Parse WWW-Authenticate header
    const realm = wwwAuth.match(/realm="([^"]+)"/)?.[1];
    const nonce = wwwAuth.match(/nonce="([^"]+)"/)?.[1];
    const qop = wwwAuth.match(/qop="([^"]+)"/)?.[1] || 'auth';
    
    if (!realm || !nonce) {
      throw new Error('Invalid WWW-Authenticate header');
    }

    console.log('WWW-Authenticate header:', wwwAuth);

    // Get the full URL path including query parameters
    const urlObj = new URL(url);
    const fullPath = urlObj.pathname + urlObj.search;

    // Calculate digest components using MD5
    const ha1 = createHash('md5').update(`${USERNAME}:${realm}:${PASSWORD}`).digest('hex');
    const ha2 = createHash('md5').update(`${method}:${fullPath}`).digest('hex');
    const nc = '00000001';
    const cnonce = Math.random().toString(36).substring(2, 10);
    const digestResponse = createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      .digest('hex');

    // Build authorization header with full path
    const authHeader = `Digest username="${USERNAME}", realm="${realm}", nonce="${nonce}", uri="${fullPath}", qop="${qop}", nc=${nc}, cnonce="${cnonce}", response="${digestResponse}", algorithm=MD5, digest="${digestResponse}"`;

    console.log('Authorization header:', authHeader);

    // Make authenticated request
    const authenticatedResponse = await fetch(url, {
      method,
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });

    console.log(`Response status: ${authenticatedResponse.status}`);
    console.log(`Response headers: ${JSON.stringify(authenticatedResponse.headers.raw(), null, 2)}`);
    const text = await authenticatedResponse.text();
    console.log(`Response body: ${text}`);

    if (!authenticatedResponse.ok) {
      throw new Error(`Request failed with status code: ${authenticatedResponse.status}`);
    }

    return JSON.parse(text);
  } catch (error: unknown) {
    console.error('Error in digestAuth:', error);
    throw new McpError(
      -32603,
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function searchDrugs(params: SearchParams) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/drugs-v2/drug/search";
  let query = params.query;

  if (!query) {
    const queryParts: string[] = [];
    
    if (params.company) queryParts.push(`companiesPrimary:"${params.company}"`);
    if (params.indication) queryParts.push(`indicationsPrimary:${params.indication}`);
    if (params.action) queryParts.push(`actionsPrimary:${params.action}`);
    if (params.phase) {
      // Handle OR and AND conditions in phase
      const phases = params.phase.split(/\s+(?:OR|AND)\s+/).map(p => p.trim());
      if (phases.length > 1) {
        // Check if original string contains OR or AND
        const operator = params.phase.match(/\s+(OR|AND)\s+/)?.[1] || 'OR';
        // Handle both formats for each phase
        const formattedPhases = phases.map(p => {
          // If it's already in the short format (L, C1, etc)
          if (/^[A-Z0-9]+$/.test(p)) {
            return `phaseHighest::${p}`;
          }
          // If it's in the descriptive format (launched, etc)
          return `phaseHighest:${p}`;
        });
        queryParts.push(`(${formattedPhases.join(` ${operator} `)})`);
      } else {
        // Single phase - handle both formats
        const phase = phases[0];
        if (/^[A-Z0-9]+$/.test(phase)) {
          queryParts.push(`phaseHighest::${phase}`);
        } else {
          queryParts.push(`phaseHighest:${phase}`);
        }
      }
    }
    if (params.phase_terminated) {
      // Handle OR and AND conditions in phase_terminated
      const phases = params.phase_terminated.split(/\s+(?:OR|AND)\s+/).map(p => p.trim());
      if (phases.length > 1) {
        // Check if original string contains OR or AND
        const operator = params.phase_terminated.match(/\s+(OR|AND)\s+/)?.[1] || 'OR';
        // Handle both formats for each phase
        const formattedPhases = phases.map(p => {
          // If it's in the short format (DX, etc)
          if (/^[A-Z0-9]+$/.test(p)) {
            return `phaseTerminated::${p}`;
          }
          // If it's in the descriptive format ("phase 2 Clinical", etc)
          return `phaseTerminated:"${p}"`;
        });
        queryParts.push(`(${formattedPhases.join(` ${operator} `)})`);
      } else {
        // Single phase - handle both formats
        const phase = phases[0];
        if (/^[A-Z0-9]+$/.test(phase)) {
          queryParts.push(`phaseTerminated::${phase}`);
        } else {
          queryParts.push(`phaseTerminated:"${phase}"`);
        }
      }
    }
    if (params.technology) queryParts.push(`technologies:${params.technology}`);
    if (params.drug_name) queryParts.push(`drugNamesAll:${params.drug_name}`);
    if (params.country) queryParts.push(`LINKED(developmentStatusCountryId:${params.country})`);
    
    query = queryParts.length > 0 ? queryParts.join(" AND ") : "*";
  }

  const url = `${baseUrl}?query=${encodeURIComponent(query)}&offset=${params.offset || 0}&filtersEnabled=false&fmt=json&hits=100`;
  const response = await digestAuth(url);
  return {
    content: [{
      type: "text",
      text: JSON.stringify(response, null, 2)
    }],
    isError: false
  };
}

async function searchCompanies(params: SearchCompaniesParams) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/company-v2/company/search";
  let query = params.query;

  if (!query) {
    const queryParts: string[] = [];
    
    if (params.company_name) queryParts.push(`companyNameDisplay:${params.company_name}`);
    if (params.hq_country) queryParts.push(`companyHqCountry:${params.hq_country}`);
    if (typeof params.deals_count === 'string') {
      // Parse the deals count string
      const dealsStr = params.deals_count.trim();
      let operator = '>';  // Default to greater than
      let count = dealsStr;
      
      if (dealsStr.startsWith('<')) {
        operator = '<';
        count = dealsStr.substring(1);
      } else if (dealsStr.startsWith('>')) {
        count = dealsStr.substring(1);
      }
      
      // Convert to number
      const dealsCount = parseInt(count);
      if (!isNaN(dealsCount)) {
        queryParts.push(`companyDealsCount:RANGE(${operator}${dealsCount})`);
      }
    }
    if (params.indications) queryParts.push(`companyIndicationsKey:${params.indications}`);
    if (params.actions) queryParts.push(`companyActionsKey:${params.actions}`);
    if (params.technologies) queryParts.push(`companyTechnologiesKey:${params.technologies}`);
    if (typeof params.company_size === 'string') {
      // Parse the company size string
      const sizeStr = params.company_size.trim();
      let operator = '>';  // Default to greater than
      let size = sizeStr;
      
      if (sizeStr.startsWith('<')) {
        operator = '<';
        size = sizeStr.substring(1);
      } else if (sizeStr.startsWith('>')) {
        size = sizeStr.substring(1);
      }
      
      // Convert billions to actual value
      const sizeValue = parseFloat(size);
      if (!isNaN(sizeValue)) {
        const sizeInActualValue = sizeValue * 1000000000;
        queryParts.push(`companyCategoryCompanySize:RANGE(${operator}${sizeInActualValue})`);
      }
    }
    if (params.status) queryParts.push(`LINKED(statusLinked:${params.status})`);
    
    query = queryParts.length > 0 ? queryParts.join(" AND ") : "*";
  }

  const url = `${baseUrl}?query=${encodeURIComponent(query)}&offset=${params.offset || 0}&hits=100&fmt=json`;
  
  console.log('Making request to:', url);
  console.log('Using credentials - Username:', USERNAME, 'Password:', PASSWORD);
  
  try {
    const response = await requestAsync({
      url,
      method: 'GET',
      auth: {
        user: USERNAME,
        pass: PASSWORD,
        sendImmediately: false
      },
      json: true
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }],
      isError: false
    };
  } catch (error) {
    console.error('Error in searchCompanies:', error);
    throw new McpError(
      -32603,
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function exploreOntology(category?: string, term?: string): Promise<any> {
  if (!category || !term) {
    throw new McpError(-32603, 'Category and search term are required');
  }

  const baseUrl = 'https://api.cortellis.com/api-ws/ws/rs/ontologies-v1';
  const searchUrl = `${baseUrl}/taxonomy/${category}/search/${encodeURIComponent(term)}?showDuplicates=1&hitSynonyms=1&fmt=json`;

  try {
    const response = await requestAsync({
      url: searchUrl,
      method: 'GET',
      auth: {
        user: USERNAME,
        pass: PASSWORD,
        sendImmediately: false
      }
    });

    if (response.statusCode === 200) {
      return JSON.parse(response.body);
    } else {
      throw new McpError(-32603, `API request failed with status code ${response.statusCode}`);
    }
  } catch (error) {
    console.error('Error in ontology search:', error);
    throw new McpError(-32603, 'Ontology search failed');
  }
}

async function getDrug(id: string) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/drugs-v2/drug";
  const url = `${baseUrl}/${id}?fmt=json`;
  const response = await digestAuth(url);
  return {
    content: [{
      type: "text",
      text: JSON.stringify(response, null, 2)
    }],
    isError: false
  };
}

async function getDrugSwot(id: string) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/drugs-v2/drug/SWOTs";
  const url = `${baseUrl}/${id}?fmt=json`;
  const response = await digestAuth(url);
  return {
    content: [{
      type: "text",
      text: JSON.stringify(response, null, 2)
    }],
    isError: false
  };
}

async function getDrugFinancial(id: string) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/drugs-v2/financial";
  const url = `${baseUrl}/${id}?fmt=json`;
  const response = await digestAuth(url);
  return {
    content: [{
      type: "text",
      text: JSON.stringify(response, null, 2)
    }],
    isError: false
  };
}

async function getCompany(id: string) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/company-v2/company";
  const url = `${baseUrl}/${id}?fmt=json`;
  const response = await digestAuth(url);
  return {
    content: [{
      type: "text",
      text: JSON.stringify(response, null, 2)
    }],
    isError: false
  };
}

async function runServer() {
  if (USE_HTTP) {
    const app = express();
    app.use(express.json());

    // Add search_drugs endpoint
    app.post('/search_drugs', async (req: Request, res: Response) => {
      try {
        const result = await searchDrugs(req.body);
        res.json(result);
      } catch (error) {
        if (error instanceof McpError) {
          res.status(500).json({ error: error.message, code: error.code });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Add explore_ontology endpoint
    app.post('/explore_ontology', async (req: Request, res: Response) => {
      try {
        const { term, category, action, indication, company, drug_name, target, technology } = req.body;
        
        let searchCategory = category;
        let searchTerm = term;

        if (!searchCategory) {
          if (action) {
            searchCategory = 'action';
            searchTerm = action;
          } else if (indication) {
            searchCategory = 'indication';
            searchTerm = indication;
          } else if (company) {
            searchCategory = 'company';
            searchTerm = company;
          } else if (drug_name) {
            searchCategory = 'drug_name';
            searchTerm = drug_name;
          } else if (target) {
            searchCategory = 'target';
            searchTerm = target;
          } else if (technology) {
            searchCategory = 'technology';
            searchTerm = technology;
          }
        }

        if (!searchTerm) {
          searchTerm = term;
        }

        if (typeof searchCategory !== 'string' || typeof searchTerm !== 'string') {
          throw new McpError(-32603, 'Invalid category or search term');
        }

        const result = await exploreOntology(searchCategory, searchTerm);
        res.json(result);
      } catch (error) {
        console.error('Error in /explore_ontology:', error);
        const mcpError = error instanceof McpError ? error : new McpError(-32603, String(error));
        res.status(500).json({
          error: `MCP error ${mcpError.code}: ${mcpError.message}`
        });
      }
    });

    // Add get_drug endpoint
    app.get('/drug/:id', async (req: Request, res: Response) => {
      try {
        const result = await getDrug(req.params.id);
        res.json(result);
      } catch (error) {
        if (error instanceof McpError) {
          res.status(500).json({ error: error.message, code: error.code });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Add get_drug_swot endpoint
    app.get('/drug/:id/swot', async (req: Request, res: Response) => {
      try {
        const result = await getDrugSwot(req.params.id);
        res.json(result);
      } catch (error) {
        if (error instanceof McpError) {
          res.status(500).json({ error: error.message, code: error.code });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Add get_drug_financial endpoint
    app.get('/drug/:id/financial', async (req: Request, res: Response) => {
      try {
        const result = await getDrugFinancial(req.params.id);
        res.json(result);
      } catch (error) {
        if (error instanceof McpError) {
          res.status(500).json({ error: error.message, code: error.code });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Add get_company endpoint
    app.get('/company/:id', async (req: Request, res: Response) => {
      try {
        const result = await getCompany(req.params.id);
        res.json(result);
      } catch (error) {
        if (error instanceof McpError) {
          res.status(500).json({ error: error.message, code: error.code });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Add search_companies endpoint
    app.post('/search_companies', async (req: Request, res: Response) => {
      try {
        const result = await searchCompanies(req.body);
        res.json(result);
      } catch (error) {
        if (error instanceof McpError) {
          res.status(500).json({ error: error.message, code: error.code });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    app.listen(PORT, () => {
      console.log(`Cortellis MCP Server running on http://localhost:${PORT}`);
    });
  } else {
    const transport = new StdioServerTransport();
    const server = new Server(
      {
        name: "cortellis",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [SEARCH_DRUGS_TOOL, EXPLORE_ONTOLOGY_TOOL, GET_DRUG_TOOL, GET_DRUG_SWOT_TOOL, GET_DRUG_FINANCIAL_TOOL, GET_COMPANY_TOOL, SEARCH_COMPANIES_TOOL]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!request.params?.name) {
        throw new McpError(
          -32603,
          "Tool name not provided"
        );
      }

      const params = request.params.arguments || {};
      
      try {
        switch (request.params.name) {
          case "search_drugs":
            return await searchDrugs(params as SearchParams);
          case "explore_ontology":
            if (typeof params.category !== 'string' || typeof params.term !== 'string') {
              throw new McpError(-32603, 'Invalid category or search term');
            }
            return await exploreOntology(params.category, params.term);
          case "get_drug":
            if (typeof params.id !== 'string') {
              throw new McpError(-32603, 'Invalid drug identifier');
            }
            return await getDrug(params.id);
          case "get_drug_swot":
            if (typeof params.id !== 'string') {
              throw new McpError(-32603, 'Invalid drug identifier');
            }
            return await getDrugSwot(params.id);
          case "get_drug_financial":
            if (typeof params.id !== 'string') {
              throw new McpError(-32603, 'Invalid drug identifier');
            }
            return await getDrugFinancial(params.id);
          case "get_company":
            if (typeof params.id !== 'string') {
              throw new McpError(-32603, 'Invalid company identifier');
            }
            return await getCompany(params.id);
          case "search_companies":
            if (params.query && typeof params.query !== 'string') {
              throw new McpError(-32603, 'Invalid query parameter');
            }
            if (params.company_name && typeof params.company_name !== 'string') {
              throw new McpError(-32603, 'Invalid company_name parameter');
            }
            if (params.hq_country && typeof params.hq_country !== 'string') {
              throw new McpError(-32603, 'Invalid hq_country parameter');
            }
            if (params.deals_count && typeof params.deals_count !== 'string') {
              throw new McpError(-32603, 'Invalid deals_count parameter');
            }
            if (params.indications && typeof params.indications !== 'string') {
              throw new McpError(-32603, 'Invalid indications parameter');
            }
            if (params.actions && typeof params.actions !== 'string') {
              throw new McpError(-32603, 'Invalid actions parameter');
            }
            if (params.technologies && typeof params.technologies !== 'string') {
              throw new McpError(-32603, 'Invalid technologies parameter');
            }
            if (params.company_size && typeof params.company_size !== 'string') {
              throw new McpError(-32603, 'Invalid company_size parameter');
            }
            if (params.status && typeof params.status !== 'string') {
              throw new McpError(-32603, 'Invalid status parameter');
            }
            return await searchCompanies(params as SearchCompaniesParams);
          default:
            throw new McpError(
              -32603,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          -32603,
          `Failed to execute ${request.params.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    await server.connect(transport);
    console.log("Cortellis MCP Server running on stdio");
  }
}

runServer().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
