#!/usr/bin/env node

/**
 * Cortellis MCP Server
 * 
 * This server provides a bridge between the Model Context Protocol (MCP) and the Cortellis API.
 * It supports both MCP server mode (with stdio or SSE transport) and HTTP server mode for flexible integration.
 * 
 * Environment Variables:
 * - CORTELLIS_USERNAME: Required. Username for Cortellis API authentication
 * - CORTELLIS_PASSWORD: Required. Password for Cortellis API authentication
 * - USE_HTTP: Optional. Set to 'true' to run as HTTP server (default: false)
 * - PORT: Optional. Port number for HTTP server (default: 3000)
 * - LOG_LEVEL: Optional. Logging level (default: 'info')
 * - TRANSPORT: Optional. MCP transport type ('stdio' or 'sse', default: 'stdio')
 * - SSE_PATH: Optional. Path for SSE endpoint when using SSE transport (default: '/mcp')
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { createError, JsonValue } from "./util.js";
import fetch from 'node-fetch';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import 'dotenv/config';
import { createHash } from 'crypto';

/**
 * Logging utility for consistent log format across the application
 * Supports different log levels and structured logging
 */
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const logger = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  } as const,
  level: (process.env.LOG_LEVEL || 'info') as LogLevel,
  
  formatMessage: (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  },

  error: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.error) {
      console.error(logger.formatMessage('error', message, meta));
    }
  },

  warn: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.warn) {
      console.warn(logger.formatMessage('warn', message, meta));
    }
  },

  info: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.info) {
      console.log(logger.formatMessage('info', message, meta));
    }
  },

  debug: (message: string, meta?: any) => {
    if (logger.levels[logger.level as keyof typeof logger.levels] >= logger.levels.debug) {
      console.debug(logger.formatMessage('debug', message, meta));
    }
  }
};

/**
 * Type definitions for schema properties and parameters
 */
interface SchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  enumDescriptions?: { [key: string]: string };
  examples?: string[];
  format?: string;
  notes?: string;
}

// API configuration and environment variables
const USERNAME = process.env.CORTELLIS_USERNAME || '';
const PASSWORD = process.env.CORTELLIS_PASSWORD || '';
const USE_HTTP = process.env.USE_HTTP === 'true';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const TRANSPORT = process.env.TRANSPORT || 'stdio';
const SSE_PATH = process.env.SSE_PATH || '/mcp';

// Validate required environment variables
if (!USERNAME || !PASSWORD) {
  logger.error("Missing required environment variables", {
    username: !USERNAME ? "missing" : "present",
    password: !PASSWORD ? "missing" : "present"
  });
  process.exit(1);
}

// Validate transport configuration
if (TRANSPORT !== 'stdio') {
  logger.warn("SSE transport is temporarily disabled. Defaulting to stdio transport.", {
    requested_transport: TRANSPORT
  });
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
        description: "Company ID for the developing company (e.g., 18614)"
      },
      indication: {
        type: "string",
        description: "Indication ID (numeric ID only, e.g., 238 for Obesity). Use explore_ontology to find the correct ID."
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
          "L",
          "C3 OR PR",
          "C2 AND C3"
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
        description: "Country ID (e.g., US)"
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
      description: "Search for Launched drugs in the US",
      usage: `{
        "phase": "L",
        "country": "US"
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
        description: "Numeric Drug Identifier (e.g. '101964' for tirzepatide, not the drug name)",
        examples: ["101964"]
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
        description: "Numeric Drug Identifier (e.g. '101964' for tirzepatide, not the drug name)",
        examples: ["101964"]
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
        description: "Numeric Drug Identifier (e.g. '101964' for tirzepatide, not the drug name)",
        examples: ["101964"]
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
        description: "Numeric Company Identifier (not the company name)",
        examples: ["12345"]
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

/**
 * Interface for search parameters used in drug queries
 * Supports both raw queries and structured parameter searches
 */
interface SearchParams {
  query?: string;            // Raw search query for direct Cortellis API syntax
  company?: string;          // Company ID for filtering by developing company
  indication?: string;       // Indication ID or name for disease/condition
  action?: string;          // Target specific action of the drug
  phase?: string;           // Overall highest development status
  phase_terminated?: string; // Last phase before NDR/DX status
  technology?: string;      // Drug development technology
  drug_name?: string;       // Name of the drug compound
  country?: string;         // Country ID for regional filtering
  offset?: number;          // Pagination offset
}

/**
 * Interface for ontology exploration parameters
 * Used to search and navigate the Cortellis taxonomy
 */
interface OntologyParams {
  term?: string;            // Generic search term
  category?: string;        // Specific category to search within
  action?: string;          // Action/mechanism specific search
  indication?: string;      // Disease/condition specific search
  company?: string;         // Company specific search
  drug_name?: string;       // Drug name specific search
  target?: string;          // Drug target specific search
  technology?: string;      // Technology specific search
}

/**
 * Interface for company search parameters
 * Supports both raw queries and structured parameter searches
 */
interface SearchCompaniesParams {
  query?: string;         // Raw search query for direct Cortellis API syntax
  company_name?: string;  // Company name to search for
  hq_country?: string;    // Company headquarters country
  deals_count?: string;   // Count of deals where company is principal/partner
  indications?: string;   // Top indication terms from company's portfolio
  actions?: string;       // Top action terms from company's portfolio
  technologies?: string;  // Top technology terms from company's portfolio
  company_size?: string;  // Company size based on market cap (in billions USD)
  status?: string;        // Highest status of company's drugs
  offset?: number;        // Pagination offset
}

interface SearchDealsParams {
  query?: string;
  dealDrugNamesAll?: string;
  indications?: string;
  dealDrugCompanyPartnerIndications?: string;
  dealPhaseHighestStart?: string;
  dealPhaseHighestNow?: string;
  dealStatus?: string;
  dealSummary?: string;
  dealTitleSummary?: string;
  technologies?: string;
  dealTitle?: string;
  dealType?: string;
  actionsPrimary?: string;
  dealDrugActionsPrimary?: string;
  dealCompanyPrincipal?: string;
  dealCompanyPartner?: string;
  dealCompanyPrincipalHq?: string;
  dealTerritoriesIncluded?: string;
  dealTerritoriesExcluded?: string;
  dealDateStart?: string;
  dealDateEnd?: string;
  dealDateEventMostRecent?: string;
  dealValuePaidToPartnerMaxNumber?: string;
  dealTotalProjectedCurrentAmount?: string;
  dealValuePaidToPartnerMinNumber?: string;
  dealTotalPaidAmount?: string;
  dealValuePaidToPrincipalMaxDisclosureStatus?: string;
  dealValuePaidToPrincipalMaxNumber?: string;
  dealValuePaidToPrincipalMinNumber?: string;
  dealValueProjectedToPartnerMaxNumber?: string;
  dealValueProjectedToPartnerMinNumber?: string;
  dealValueProjectedToPrincipalMaxDisclosureStatus?: string;
  dealValueProjectedToPrincipalMaxNumber?: string;
  dealValueProjectedToPrincipalMinNumber?: string;
  offset?: number;
}

const SEARCH_DEALS_TOOL: Tool = {
  name: "search_deals",
  description: "Search for deals in the Cortellis database. Supports all deal search parameters, including drug, company, indication, phase, value, and date filters.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Raw search query (if you want to use the full Cortellis query syntax directly)" },
      dealDrugNamesAll: { type: "string", description: "Main name of drug including synonyms associated with the deal" },
      indications: { type: "string", description: "Indications associated with the deal" },
      dealDrugCompanyPartnerIndications: { type: "string", description: "The indication and the partner company linked to a drug associated with the deal" },
      dealPhaseHighestStart: { type: "string", description: "Highest dev. status of the drug at the deal start" },
      dealPhaseHighestNow: { type: "string", description: "Current highest dev. status of the drug" },
      dealStatus: { type: "string", description: "Status of the deal" },
      dealSummary: { type: "string", description: "Summary of the deal" },
      dealTitleSummary: { type: "string", description: "Title or summary of the deal" },
      technologies: { type: "string", description: "Technology linked to the drug" },
      dealTitle: { type: "string", description: "Title of the deal" },
      dealType: { type: "string", description: "Type of deal" },
      actionsPrimary: { type: "string", description: "Primary mechanism of action associated with the deal" },
      dealDrugActionsPrimary: { type: "string", description: "The primary mechanism of action of a drug associated with the deal" },
      dealCompanyPrincipal: { type: "string", description: "Principal company (Seller/Licensor)" },
      dealCompanyPartner: { type: "string", description: "Partner company (Buyer/Licensee)" },
      dealCompanyPrincipalHq: { type: "string", description: "Location of the HQ of the principal company" },
      dealTerritoriesIncluded: { type: "string", description: "The deal applies in the included countries" },
      dealTerritoriesExcluded: { type: "string", description: "The deal doesn't apply in the excluded countries" },
      dealDateStart: { type: "string", description: "Start date of the deal" },
      dealDateEnd: { type: "string", description: "End date of the deal" },
      dealDateEventMostRecent: { type: "string", description: "Date of the latest timeline event" },
      dealValuePaidToPartnerMaxNumber: { type: "string", description: "Maximal paid payment amount to partner company in M USD considering the accuracy range" },
      dealTotalProjectedCurrentAmount: { type: "string", description: "Total current projection of the agreement in US dollars million" },
      dealValuePaidToPartnerMinNumber: { type: "string", description: "Minimal paid payment amount to partner company in M USD considering the accuracy range" },
      dealTotalPaidAmount: { type: "string", description: "Total payment value of the agreement realized in US dollars million" },
      dealValuePaidToPrincipalMaxDisclosureStatus: { type: "string", description: "Whether the paid payment of the principal company is either 'Payment Unspecified', 'Unknown', or 'Known'" },
      dealValuePaidToPrincipalMaxNumber: { type: "string", description: "Maximal paid amount to principal company in M USD considering the accuracy range" },
      dealValuePaidToPrincipalMinNumber: { type: "string", description: "Minimal paid amount to principal company in M USD considering the accuracy range" },
      dealValueProjectedToPartnerMaxNumber: { type: "string", description: "Maximal projected current amount to partner company in M USD considering the accuracy range" },
      dealValueProjectedToPartnerMinNumber: { type: "string", description: "Minimal projected current amount to partner company in M USD considering the accuracy range" },
      dealValueProjectedToPrincipalMaxDisclosureStatus: { type: "string", description: "Whether the projected current payment of the principal company is either 'Payment Unspecified', 'Unknown', or 'Known'" },
      dealValueProjectedToPrincipalMaxNumber: { type: "string", description: "Maximal projected current amount to principal company in M USD considering the accuracy range" },
      dealValueProjectedToPrincipalMinNumber: { type: "string", description: "Minimal projected current amount to principal company in M USD considering the accuracy range" },
      offset: { type: "number", description: "Starting position in the results (default: 0)" }
    }
  },
  examples: [
    {
      description: "Search for completed deals involving melanoma",
      usage: `{
        "dealStatus": "Completed",
        "indications": "Melanoma"
      }`
    }
  ]
};

function createMcpError(message: string, code: number = -32603): McpError {
  return new McpError(code, message);
}

/**
 * Performs digest authentication for Cortellis API requests
 * Implements a two-step authentication process:
 * 1. Initial request to get nonce
 * 2. Authenticated request with digest credentials
 * 
 * @param url - The API endpoint URL
 * @param method - HTTP method (default: 'GET')
 * @returns Promise resolving to the API response
 * @throws McpError if authentication or request fails
 */
async function digestAuth(url: string, method: string = 'GET'): Promise<JsonValue> {
  try {
    logger.info(`[digestAuth] Starting request to: ${url}`);
    logger.info(`[digestAuth] Using method: ${method}`);
    
    // First request to get the nonce
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
    if (!authHeader) {
      throw new McpError(-32603, 'No WWW-Authenticate header received');
    }

    // Parse WWW-Authenticate header
    const realm = authHeader.match(/realm="([^"]+)"/)?.[1];
    const nonce = authHeader.match(/nonce="([^"]+)"/)?.[1];
    const qop = authHeader.match(/qop="([^"]+)"/)?.[1];

    if (!realm || !nonce) {
      throw new McpError(-32603, 'Invalid WWW-Authenticate header - missing realm or nonce');
    }

    // Generate cnonce and nc only if qop is specified
    let digestResponse: string;
    
    if (qop) {
      const cnonce = Math.random().toString(36).substring(2);
      const nc = '00000001';

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

      // Construct Authorization header without qop
      digestResponse = `Digest username="${USERNAME}", realm="${realm}", nonce="${nonce}", uri="${url}", response="${response_value}", algorithm="MD5"`;
    }

    // Make authenticated request
    const authenticatedResponse = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Cortellis API Client',
        'Authorization': digestResponse
      }
    });

    if (!authenticatedResponse.ok) {
      const errorText = await authenticatedResponse.text();
      throw new McpError(
        -32603,
        `Request failed with status ${authenticatedResponse.status}: ${errorText}`
      );
    }

    const text = await authenticatedResponse.text();
    
    try {
      const jsonResponse = JSON.parse(text);
      if (!jsonResponse) {
        throw new McpError(-32603, 'Empty response from API');
      }
      return jsonResponse;
    } catch (parseError) {
      throw new McpError(
        -32603,
        `Invalid JSON response: ${text.substring(0, 100)}...`
      );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      -32603,
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Searches for drugs in the Cortellis database
 * Constructs queries based on provided parameters and handles both
 * LINKED and non-LINKED parameters appropriately
 * 
 * @param params - Search parameters for filtering drugs
 * @returns Promise resolving to the search results
 * @throws McpError if the search fails
 */
async function searchDrugs(params: SearchParams) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/drugs-v2/drug/search";
  let query = params.query;

  if (!query) {
    const linkedParts: string[] = [];
    const otherParts: string[] = [];
    
    // Handle development status related parameters with LINKED clause
    if (params.company) linkedParts.push(`developmentStatusCompanyId:${params.company}`);
    if (params.indication) linkedParts.push(`developmentStatusIndicationId:${params.indication}`);
    if (params.country) linkedParts.push(`developmentStatusCountryId:${params.country}`);
    if (params.phase) linkedParts.push(`developmentStatusPhaseId:${params.phase}`);
    
    // Handle other parameters
    if (params.technology) otherParts.push(`technologies:${params.technology}`);
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
        otherParts.push(`(${formattedPhases.join(` ${operator} `)})`);
      } else {
        // Single phase - handle both formats
        const phase = phases[0];
        if (/^[A-Z0-9]+$/.test(phase)) {
          otherParts.push(`phaseTerminated::${phase}`);
        } else {
          otherParts.push(`phaseTerminated:"${phase}"`);
        }
      }
    }
    if (params.action) otherParts.push(`actionsPrimary:${params.action}`);
    if (params.drug_name) otherParts.push(`drugNamesAll:${params.drug_name}`);
    
    // Construct final query - combine LINKED clause with other parts
    const linkedQuery = linkedParts.length > 0 ? `LINKED(${linkedParts.join(" AND ")})` : "";
    const otherQuery = otherParts.length > 0 ? otherParts.join(" AND ") : "";
    
    if (linkedQuery && otherQuery) {
      query = `${linkedQuery} AND ${otherQuery}`;
    } else if (linkedQuery) {
      query = linkedQuery;
    } else if (otherQuery) {
      query = otherQuery;
    } else {
      query = "*";
    }
  }

  // Add proper URL encoding and parameters
  const url = `${baseUrl}?query=${encodeURIComponent(query)}&offset=${params.offset || 0}&filtersEnabled=false&fmt=json&hits=100`;
  logger.info('Generated URL:', url);
  logger.info('Generated query:', query);
  
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
    logger.error('Error in searchDrugs:', error);
    throw new McpError(
      -32603,
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Searches for companies in the Cortellis database
 * Supports various company-specific filters and search criteria
 * 
 * @param params - Search parameters for filtering companies
 * @returns Promise resolving to the search results
 * @throws McpError if the search fails
 */
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
  
  logger.info('Making request to:', url);
  
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
    logger.error('Error in searchCompanies:', error);
    throw new McpError(
      -32603,
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Explores the Cortellis ontology/taxonomy
 * Provides term lookup and category-specific searches
 * 
 * @param params - Parameters for ontology exploration
 * @returns Promise resolving to matching taxonomy terms
 * @throws McpError if the exploration fails
 */
async function exploreOntology(params: OntologyParams) {
  try {
    logger.info('Received params:', params);

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

    logger.info('Resolved search parameters:', { searchCategory, searchTerm });

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

    logger.info('Making request to URL:', searchUrl);

    const response = await digestAuth(searchUrl);
    logger.info('Raw API Response:', JSON.stringify(response, null, 2));

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
    logger.error('Error in exploreOntology:', error);
    throw new McpError(
      -32603,
      `Ontology search failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Retrieves detailed information for a specific drug
 * 
 * @param id - Drug identifier
 * @returns Promise resolving to the complete drug record
 * @throws McpError if the retrieval fails
 */
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

/**
 * Retrieves SWOT analysis for a specific drug
 * 
 * @param id - Drug identifier
 * @returns Promise resolving to the drug's SWOT analysis
 * @throws McpError if the retrieval fails
 */
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

/**
 * Retrieves financial data and forecasts for a specific drug
 * 
 * @param id - Drug identifier
 * @returns Promise resolving to the drug's financial information
 * @throws McpError if the retrieval fails
 */
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

/**
 * Retrieves detailed information for a specific company
 * 
 * @param id - Company identifier
 * @returns Promise resolving to the complete company record
 * @throws McpError if the retrieval fails
 */
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

async function searchDeals(params: SearchDealsParams) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/deals-v2/deal/search";
  let query = params.query;

  if (!query) {
    const queryParts: string[] = [];
    if (params.dealDrugNamesAll) queryParts.push(`dealDrugNamesAll:${params.dealDrugNamesAll}`);
    if (params.indications) queryParts.push(`indications:${params.indications}`);
    if (params.dealDrugCompanyPartnerIndications) queryParts.push(`dealDrugCompanyPartnerIndications:${params.dealDrugCompanyPartnerIndications}`);
    if (params.dealPhaseHighestStart) queryParts.push(`dealPhaseHighestStart:${params.dealPhaseHighestStart}`);
    if (params.dealPhaseHighestNow) queryParts.push(`dealPhaseHighestNow:${params.dealPhaseHighestNow}`);
    if (params.dealStatus) queryParts.push(`dealStatus:${params.dealStatus}`);
    if (params.dealSummary) queryParts.push(`dealSummary:${params.dealSummary}`);
    if (params.dealTitleSummary) queryParts.push(`dealTitleSummary:${params.dealTitleSummary}`);
    if (params.technologies) queryParts.push(`technologies:${params.technologies}`);
    if (params.dealTitle) queryParts.push(`dealTitle:${params.dealTitle}`);
    if (params.dealType) queryParts.push(`dealType:${params.dealType}`);
    if (params.actionsPrimary) queryParts.push(`actionsPrimary:${params.actionsPrimary}`);
    if (params.dealDrugActionsPrimary) queryParts.push(`dealDrugActionsPrimary:${params.dealDrugActionsPrimary}`);
    if (params.dealCompanyPrincipal) queryParts.push(`dealCompanyPrincipal:${params.dealCompanyPrincipal}`);
    if (params.dealCompanyPartner) queryParts.push(`dealCompanyPartner:${params.dealCompanyPartner}`);
    if (params.dealCompanyPrincipalHq) queryParts.push(`dealCompanyPrincipalHq:${params.dealCompanyPrincipalHq}`);
    if (params.dealTerritoriesIncluded) queryParts.push(`dealTerritoriesIncluded:${params.dealTerritoriesIncluded}`);
    if (params.dealTerritoriesExcluded) queryParts.push(`dealTerritoriesExcluded:${params.dealTerritoriesExcluded}`);
    if (params.dealDateStart) queryParts.push(`dealDateStart:${params.dealDateStart}`);
    if (params.dealDateEnd) queryParts.push(`dealDateEnd:${params.dealDateEnd}`);
    if (params.dealDateEventMostRecent) queryParts.push(`dealDateEventMostRecent:${params.dealDateEventMostRecent}`);
    if (params.dealValuePaidToPartnerMaxNumber) queryParts.push(`dealValuePaidToPartnerMaxNumber:${params.dealValuePaidToPartnerMaxNumber}`);
    if (params.dealTotalProjectedCurrentAmount) queryParts.push(`dealTotalProjectedCurrentAmount:${params.dealTotalProjectedCurrentAmount}`);
    if (params.dealValuePaidToPartnerMinNumber) queryParts.push(`dealValuePaidToPartnerMinNumber:${params.dealValuePaidToPartnerMinNumber}`);
    if (params.dealTotalPaidAmount) queryParts.push(`dealTotalPaidAmount:${params.dealTotalPaidAmount}`);
    if (params.dealValuePaidToPrincipalMaxDisclosureStatus) queryParts.push(`dealValuePaidToPrincipalMaxDisclosureStatus:${params.dealValuePaidToPrincipalMaxDisclosureStatus}`);
    if (params.dealValuePaidToPrincipalMaxNumber) queryParts.push(`dealValuePaidToPrincipalMaxNumber:${params.dealValuePaidToPrincipalMaxNumber}`);
    if (params.dealValuePaidToPrincipalMinNumber) queryParts.push(`dealValuePaidToPrincipalMinNumber:${params.dealValuePaidToPrincipalMinNumber}`);
    if (params.dealValueProjectedToPartnerMaxNumber) queryParts.push(`dealValueProjectedToPartnerMaxNumber:${params.dealValueProjectedToPartnerMaxNumber}`);
    if (params.dealValueProjectedToPartnerMinNumber) queryParts.push(`dealValueProjectedToPartnerMinNumber:${params.dealValueProjectedToPartnerMinNumber}`);
    if (params.dealValueProjectedToPrincipalMaxDisclosureStatus) queryParts.push(`dealValueProjectedToPrincipalMaxDisclosureStatus:${params.dealValueProjectedToPrincipalMaxDisclosureStatus}`);
    if (params.dealValueProjectedToPrincipalMaxNumber) queryParts.push(`dealValueProjectedToPrincipalMaxNumber:${params.dealValueProjectedToPrincipalMaxNumber}`);
    if (params.dealValueProjectedToPrincipalMinNumber) queryParts.push(`dealValueProjectedToPrincipalMinNumber:${params.dealValueProjectedToPrincipalMinNumber}`);
    query = queryParts.length > 0 ? queryParts.join(" AND ") : "*";
  }

  const url = `${baseUrl}?query=${encodeURIComponent(query)}&offset=${params.offset || 0}&fmt=json&hits=100`;
  const response = await digestAuth(url);
  return {
    content: [{
      type: "text",
      text: JSON.stringify(response, null, 2)
    }],
    isError: false
  };
}

/**
 * Main server initialization and setup function
 * Supports both HTTP and MCP server modes with configurable transport
 * 
 * @throws Error if server initialization fails
 */
async function runServer() {
  // Check for --list-tools flag
  if (process.argv.includes('--list-tools')) {
    logger.info(JSON.stringify([
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
      },
      {
        name: SEARCH_DEALS_TOOL.name,
        description: SEARCH_DEALS_TOOL.description,
        schema: Object.entries(SEARCH_DEALS_TOOL.inputSchema.properties || {}).map(([key, prop]) => ({
          name: key,
          type: (prop as SchemaProperty).type,
          description: (prop as SchemaProperty).description,
          ...((prop as SchemaProperty).format ? { format: (prop as SchemaProperty).format } : {})
        }))
      }
    ], null, 2));
    return;
  }

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

  // Set up request handlers
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

  if (USE_HTTP) {
    const app = express();
    app.use(express.json());

    // Add logging middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${req.method} ${req.url}`);
      next();
    });

    // Update error handling middleware
    app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      logger.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

    // Add search_drugs endpoint
    app.post('/search_drugs', async (req: Request, res: Response) => {
      try {
        logger.info('Received search_drugs request:', req.body);
        const { query, company, indication, action, phase, phase_terminated, technology, drug_name, country, offset } = req.body;
        
        let finalQuery = query;
        if (!finalQuery) {
          const linkedParts: string[] = [];
          
          // Handle development status related parameters with LINKED clause
          if (company) linkedParts.push(`developmentStatusCompanyId:${company}`);
          if (indication) linkedParts.push(`developmentStatusIndicationId:${indication}`);
          if (country) linkedParts.push(`developmentStatusCountryId:${country}`);
          if (phase) linkedParts.push(`developmentStatusPhaseId:${phase}`);
          
          // Only use the LINKED clause
          finalQuery = linkedParts.length > 0 ? `LINKED(${linkedParts.join(" AND ")})` : "*";
        }

        logger.info('Generated query:', finalQuery);
        
        const result = await searchDrugs({ query: finalQuery, offset });
        res.json(result);
      } catch (error) {
        logger.error('Error in /search_drugs:', error);
        const mcpError = error instanceof McpError ? error : new McpError(-32603, String(error));
        res.status(500).json({
          error: `MCP error ${mcpError.code}: ${mcpError.message}`,
          code: 500
        });
      }
    });

    // Add explore_ontology endpoint
    app.post('/explore_ontology', async (req: Request, res: Response) => {
      try {
        logger.info('Received explore_ontology request:', req.body);
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

        logger.info('Making ontology search request with:', { searchCategory, searchTerm });
        const result = await exploreOntology({ term: searchTerm, category: searchCategory });
        logger.info('Ontology search result:', result);
        res.json(result);
      } catch (error) {
        logger.error('Error in /explore_ontology:', error);
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
      const httpServer = app.listen(PORT, () => {
        logger.info(`Cortellis MCP Server running on http://localhost:${PORT}`);
        if (TRANSPORT === 'sse') {
          logger.info(`SSE endpoint available at http://localhost:${PORT}${SSE_PATH}`);
        }
      });

      // Handle server errors
      httpServer.on('error', (error: Error & { code?: string }) => {
        logger.error('Server error:', error);
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${PORT} is already in use`);
        }
        process.exit(1);
      });
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  } else {
    // Non-HTTP mode
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
    logger.info(`Cortellis MCP Server running with ${TRANSPORT} transport`);
  }
}

runServer().catch((error) => {
  logger.error("Server error:", error);
  process.exit(1);
});
