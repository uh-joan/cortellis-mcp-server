#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { createError, JsonValue } from "./util.js";
import fetch from 'node-fetch';
import express, { Request, Response, NextFunction } from 'express';
import 'dotenv/config';
import { createHash } from 'crypto';

// Add type definitions at the top of the file, after the imports
interface SchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  enumDescriptions?: { [key: string]: string };
  examples?: string[];
  format?: string;
  notes?: string;
}

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
        description: "Drug Identifier"
      }
    },
    required: ["id"]
  }
};

const GET_DRUG_SWOT_TOOL: Tool = {
  name: "get_drug_swot",
  description: "Return SWOT analysis complementing chosen drug record for a submitted drug identifier from Cortellis API",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Drug Identifier"
      }
    },
    required: ["id"]
  }
};

const GET_DRUG_FINANCIAL_TOOL: Tool = {
  name: "get_drug_financial",
  description: "Return financial commentary and data (actual sales and consensus forecast) for a submitted drug identifier from Cortellis API",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Drug Identifier"
      }
    },
    required: ["id"]
  }
};

const GET_COMPANY_TOOL: Tool = {
  name: "get_company",
  description: "Return the entire company record with all available fields for a given identifier from Cortellis API",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Company identifier"
      }
    },
    required: ["id"]
  }
};

const SEARCH_COMPANIES_TOOL: Tool = {
  name: "search_companies",
  description: "Search for companies in the Cortellis database. If the amount of companies returned do not match with the totalResults, ALWAYS use the offset parameter to get the next page(s) of results.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Raw search query (if you want to use the full Cortellis query syntax directly)"
      },
      company_name: {
        type: "string",
        description: "Company name to search for (e.g. pfizer)"
      },
      hq_country: {
        type: "string",
        description: "Company headquarters country (e.g. US)"
      },
      deals_count: {
        type: "string",
        description: "Count for all distinct deals where the company is a principal or partner. Format: '<20' for less than 20 deals, '20' for greater than 20 deals (default behavior)"
      },
      indications: {
        type: "string",
        description: "Top 10 indication terms from drugs and patents where company is main assignee (e.g. asthma)"
      },
      actions: {
        type: "string",
        description: "Top 10 target-based action terms from drugs and patents where company is main assignee (e.g. cyclooxygenase)"
      },
      technologies: {
        type: "string",
        description: "Top 10 technologies terms from drugs and patents where company is main assignee (e.g. Antibiotic)"
      },
      company_size: {
        type: "string",
        description: "The size of a company based on the market capitalization in billions USD. Format: '<2' for less than $2B, '2' for greater than $2B (default behavior)"
      },
      status: {
        type: "string",
        description: "Highest status of the associated drug linked to the company (e.g. launched)"
      },
      offset: {
        type: "number",
        description: "Starting position in the results (default: 0)"
      }
    }
  }
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

function createMcpError(message: string, code: number = -32603): McpError {
  return new McpError(code, message);
}

async function digestAuth(url: string, method: string = 'GET'): Promise<JsonValue> {
  try {
    console.log(`[digestAuth] Starting request to: ${url}`);
    console.log(`[digestAuth] Using method: ${method}`);
    console.log(`[digestAuth] Using credentials - Username: ${USERNAME}, Password: ${PASSWORD ? '***' : 'not set'}`);
    
    // First request to get the nonce
    console.log('[digestAuth] Making initial request to get WWW-Authenticate header');
    const response = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Cortellis API Client'
      }
    });

    // Get WWW-Authenticate header
    const authHeader = response.headers.get('www-authenticate');
    console.log('[digestAuth] WWW-Authenticate header:', authHeader);
    
    if (!authHeader) {
      throw new Error('No WWW-Authenticate header received');
    }

    // Parse WWW-Authenticate header
    const realm = authHeader.match(/realm="([^"]+)"/)?.[1];
    const nonce = authHeader.match(/nonce="([^"]+)"/)?.[1];
    const qop = authHeader.match(/qop="([^"]+)"/)?.[1]; // Optional
    const stale = authHeader.match(/stale="([^"]+)"/)?.[1]; // Optional
    
    console.log('[digestAuth] Parsed auth parameters:', { realm, nonce, qop, stale });

    if (!realm || !nonce) {
      throw new Error('Invalid WWW-Authenticate header - missing realm or nonce');
    }

    // Generate cnonce and nc only if qop is specified
    let cnonce, nc, digestResponse;
    
    if (qop) {
      // If qop is specified, use RFC 2617 algorithm
      cnonce = Math.random().toString(36).substring(2);
      nc = '00000001';
      console.log('[digestAuth] Generated values:', { cnonce, nc });

      // Calculate hashes
      const ha1 = createHash('md5')
        .update(`${USERNAME}:${realm}:${PASSWORD}`)
        .digest('hex');
      
      const ha2 = createHash('md5')
        .update(`${method}:${url}`)
        .digest('hex');
      
      const response_value = createHash('md5')
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        .digest('hex');

      console.log('[digestAuth] Calculated hashes:', { ha1: '***', ha2, response_value });

      // Construct Authorization header with qop
      digestResponse = `Digest username="${USERNAME}", realm="${realm}", nonce="${nonce}", uri="${url}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response_value}", algorithm="MD5"`;
    } else {
      // If no qop, use RFC 2069 algorithm
      const ha1 = createHash('md5')
        .update(`${USERNAME}:${realm}:${PASSWORD}`)
        .digest('hex');
      
      const ha2 = createHash('md5')
        .update(`${method}:${url}`)
        .digest('hex');
      
      const response_value = createHash('md5')
        .update(`${ha1}:${nonce}:${ha2}`)
        .digest('hex');

      console.log('[digestAuth] Calculated hashes (no qop):', { ha1: '***', ha2, response_value });

      // Construct Authorization header without qop
      digestResponse = `Digest username="${USERNAME}", realm="${realm}", nonce="${nonce}", uri="${url}", response="${response_value}", algorithm="MD5"`;
    }

    console.log('[digestAuth] Authorization header:', digestResponse);

    // Make authenticated request
    console.log('[digestAuth] Making authenticated request');
    const authenticatedResponse = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Cortellis API Client',
        'Authorization': digestResponse
      }
    });

    console.log('[digestAuth] Response status:', authenticatedResponse.status);
    console.log('[digestAuth] Response headers:', JSON.stringify(authenticatedResponse.headers.raw(), null, 2));
    
    const text = await authenticatedResponse.text();
    console.log('[digestAuth] Response body:', text);

    if (!authenticatedResponse.ok) {
      throw new Error(`Request failed with status code: ${authenticatedResponse.status}`);
    }

    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error('[digestAuth] Error parsing JSON response:', parseError);
      throw new Error(`Invalid JSON response: ${text}`);
    }
  } catch (error: unknown) {
    console.error('[digestAuth] Error:', error);
    throw createError(
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
      const phases = params.phase.split(/\s+(?:OR|AND)\s+/).map((p: string) => p.trim());
      if (phases.length > 1) {
        // Check if original string contains OR or AND
        const operator = params.phase.match(/\s+(OR|AND)\s+/)?.[1] || 'OR';
        // Handle both formats for each phase
        const formattedPhases = phases.map((p: string) => {
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
  
  try {
    const response = await digestAuth(url);
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

async function exploreOntology(params: OntologyParams) {
  try {
    console.log('Received params:', params);

    // Determine which parameter to use as the search term
    let searchTerm = params.term;
    let searchCategory = params.category;

    // If no explicit term/category provided, check other parameters
    if (!searchCategory || !searchTerm) {
      if (params.action) {
        searchCategory = 'action';
        searchTerm = params.action;
      } else if (params.indication) {
        searchCategory = 'indication';
        searchTerm = params.indication;
      } else if (params.company) {
        searchCategory = 'company';
        searchTerm = params.company;
      } else if (params.drug_name) {
        searchCategory = 'drug_name';
        searchTerm = params.drug_name;
      } else if (params.target) {
        searchCategory = 'target';
        searchTerm = params.target;
      } else if (params.technology) {
        searchCategory = 'technology';
        searchTerm = params.technology;
      }
    }

    console.log('Resolved search parameters:', { searchCategory, searchTerm });

    if (!searchCategory || !searchTerm) {
      throw new McpError(-32603, 'Category and search term are required');
    }

    // Map category to the correct API endpoint
    const categoryMap: { [key: string]: string } = {
      'action': 'action',
      'indication': 'indication',
      'company': 'company',
      'drug_name': 'drug',
      'target': 'target',
      'technology': 'technology'
    };

    const apiCategory = categoryMap[searchCategory];
    if (!apiCategory) {
      throw new McpError(-32603, `Invalid category: ${searchCategory}`);
    }

    const baseUrl = 'https://api.cortellis.com/api-ws/ws/rs/ontologies-v1/taxonomy';
    const searchUrl = `${baseUrl}/${apiCategory}/search/${encodeURIComponent(searchTerm)}?showDuplicates=0&hitSynonyms=1&fmt=json`;

    console.log('Making request to URL:', searchUrl);

    const response = await digestAuth(searchUrl);
    console.log('Raw API Response:', JSON.stringify(response, null, 2));

    if (!response) {
      throw new Error('Empty response from API');
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }],
      isError: false
    };
  } catch (error: any) {
    console.error('Error in exploreOntology:', error);
    throw new McpError(
      -32603,
      `Ontology search failed: ${error instanceof Error ? error.message : String(error)}`
    );
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
  // Check for --list-tools flag
  if (process.argv.includes('--list-tools')) {
    console.log(JSON.stringify([
      {
        name: SEARCH_DRUGS_TOOL.name,
        description: SEARCH_DRUGS_TOOL.description,
        schema: Object.entries(SEARCH_DRUGS_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description,
          ...((prop as SchemaProperty).enum ? { enum: (prop as SchemaProperty).enum } : {}),
          ...((prop as SchemaProperty).enumDescriptions ? { enumDescriptions: (prop as SchemaProperty).enumDescriptions } : {}),
          ...((prop as SchemaProperty).examples ? { examples: (prop as SchemaProperty).examples } : {}),
          ...((prop as SchemaProperty).format ? { format: (prop as SchemaProperty).format } : {}),
          ...((prop as SchemaProperty).notes ? { notes: (prop as SchemaProperty).notes } : {})
        }))
      },
      {
        name: EXPLORE_ONTOLOGY_TOOL.name,
        description: EXPLORE_ONTOLOGY_TOOL.description,
        schema: Object.entries(EXPLORE_ONTOLOGY_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description,
          ...((prop as SchemaProperty).enum ? { enum: (prop as SchemaProperty).enum } : {}),
          ...((prop as SchemaProperty).enumDescriptions ? { enumDescriptions: (prop as SchemaProperty).enumDescriptions } : {}),
          ...((prop as SchemaProperty).examples ? { examples: (prop as SchemaProperty).examples } : {})
        }))
      },
      {
        name: GET_DRUG_TOOL.name,
        description: GET_DRUG_TOOL.description,
        schema: Object.entries(GET_DRUG_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description
        }))
      },
      {
        name: GET_DRUG_SWOT_TOOL.name,
        description: GET_DRUG_SWOT_TOOL.description,
        schema: Object.entries(GET_DRUG_SWOT_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description
        }))
      },
      {
        name: GET_DRUG_FINANCIAL_TOOL.name,
        description: GET_DRUG_FINANCIAL_TOOL.description,
        schema: Object.entries(GET_DRUG_FINANCIAL_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description
        }))
      },
      {
        name: GET_COMPANY_TOOL.name,
        description: GET_COMPANY_TOOL.description,
        schema: Object.entries(GET_COMPANY_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description
        }))
      },
      {
        name: SEARCH_COMPANIES_TOOL.name,
        description: SEARCH_COMPANIES_TOOL.description,
        schema: Object.entries(SEARCH_COMPANIES_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description,
          ...((prop as SchemaProperty).format ? { format: (prop as SchemaProperty).format } : {})
        }))
      }
    ], null, 2));
    return;
  }

  if (USE_HTTP) {
    const app = express();
    app.use(express.json());

    // Add logging middleware
    app.use((req: Request, res: Response, next) => {
      console.log(`${req.method} ${req.url}`);
      next();
    });

    // Update error handling middleware
    app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      console.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

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
        console.log('Received explore_ontology request:', req.body);
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

        console.log('Making ontology search request with:', { searchCategory, searchTerm });
        const result = await exploreOntology({ term: searchTerm, category: searchCategory });
        console.log('Ontology search result:', result);
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

    // Start the server
    try {
      const server = app.listen(PORT, () => {
        console.log(`Cortellis MCP Server running on http://localhost:${PORT}`);
      });

      // Handle server errors
      server.on('error', (error: Error & { code?: string }) => {
        console.error('Server error:', error);
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use`);
        }
        process.exit(1);
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
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
            return await exploreOntology(params as OntologyParams);
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
