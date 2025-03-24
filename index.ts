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
        description: "Overall Highest development status of drug (S: Suspended, DR: Discovery/Preclinical, CU: Clinical unknown, C1-C3: Phase 1-3, PR: Pre-registration, R: Registered, L: Launched, OL: Outlicensed, NDR: No Development Reported, DX: Discontinued, W: Withdrawn)"
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
      }
    }
  }
};

const EXPLORE_ONTOLOGY_TOOL: Tool = {
  name: "explore_ontology",
  description: "Explore the ontology or taxonomy terms in the Cortellis database",
  inputSchema: {
    type: "object",
    properties: {
      term: {
        type: "string",
        description: "Generic search term (used only if no specific category is provided)"
      },
      category: {
        type: "string",
        description: "Category to search within (action, indication, company, drug_name, target, technology)"
      },
      action: {
        type: "string",
        description: "Target specific action of the drug (e.g. glucagon, GLP-1)"
      },
      indication: {
        type: "string",
        description: "Active indications of a drug (e.g. obesity, cancer)"
      },
      company: {
        type: "string",
        description: "Active companies developing drugs"
      },
      drug_name: {
        type: "string",
        description: "Drug name to search"
      },
      target: {
        type: "string",
        description: "Target of the drug"
      },
      technology: {
        type: "string",
        description: "Technologies used in drug development"
      }
    }
  }
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

async function digestAuth(url: string) {
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
    const ha2 = createHash('md5').update(`GET:${fullPath}`).digest('hex');
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
    if (params.phase) queryParts.push(`phaseHighest::${params.phase}`);
    if (params.phase_terminated) queryParts.push(`phaseTerminated::${params.phase_terminated}`);
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
      tools: [SEARCH_DRUGS_TOOL, EXPLORE_ONTOLOGY_TOOL, GET_DRUG_TOOL, GET_DRUG_SWOT_TOOL, GET_DRUG_FINANCIAL_TOOL]
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
