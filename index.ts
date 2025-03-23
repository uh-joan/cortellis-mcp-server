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
import 'dotenv/config';

// API credentials from environment variables
const USERNAME = process.env.CORTELLIS_USERNAME;
const PASSWORD = process.env.CORTELLIS_PASSWORD;

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

async function digestAuth(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Digest ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64'),
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`);
    }

    return await response.json();
  } catch (error: unknown) {
    throw new McpError(
      ErrorCode.InternalError,
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

async function exploreOntology(params: OntologyParams) {
  const baseUrl = "https://api.cortellis.com/api-ws/ws/rs/ontologies-v1/taxonomy";
  let searchCategory: string | undefined;
  let searchTerm: string | undefined;

  if (params.action) {
    searchCategory = "action";
    searchTerm = params.action;
  } else if (params.indication) {
    searchCategory = "indication";
    searchTerm = params.indication;
  } else if (params.company) {
    searchCategory = "company";
    searchTerm = params.company;
  } else if (params.drug_name) {
    searchCategory = "drug_name";
    searchTerm = params.drug_name;
  } else if (params.target) {
    searchCategory = "target";
    searchTerm = params.target;
  } else if (params.technology) {
    searchCategory = "technology";
    searchTerm = params.technology;
  } else if (params.category && params.term) {
    searchCategory = params.category;
    searchTerm = params.term;
  }

  if (!searchCategory || !searchTerm) {
    throw new McpError(
      ErrorCode.InternalError,
      "Please specify a category (action, indication, company, drug_name, target, technology) along with your search term."
    );
  }

  const url = `${baseUrl}/${searchCategory}/search/${searchTerm}?showDuplicates=0&hitSynonyms=1&fmt=json`;
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
    tools: [SEARCH_DRUGS_TOOL, EXPLORE_ONTOLOGY_TOOL]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!request.params?.name) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "Tool name not provided"
      );
    }

    const params = request.params.arguments || {};
    
    try {
      switch (request.params.name) {
        case "search_drugs":
          return await searchDrugs(params as SearchParams);
        case "explore_ontology":
          return await exploreOntology(params as OntologyParams);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    } catch (error: unknown) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to execute ${request.params.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  await server.connect(transport);
  console.error("Cortellis MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
