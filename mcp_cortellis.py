import httpx
from mcp.server.fastmcp import FastMCP
import requests
from requests.auth import HTTPDigestAuth
import xml.etree.ElementTree as ET
from typing import Dict, List

mcp = FastMCP("Cortellis MCP")

@mcp.tool()
def search_drugs(query: str = None, company: str = None, indication: str = None, 
                 action: str = None, phase: str = None, phase_terminated: str = None,
                 technology: str = None, drug_name: str = None, country: str = None,
                 offset: int = 0) -> str:
    """
    Search for drugs in the Cortellis database. If the amount of drugs returned do not match with the totalResults, ALWAYS use the offset parameter to get the next page(s) of results. THIS IS IMPORTANT.
    Args:
        query: Raw search query (if you want to use the full Cortellis query syntax directly)
        company: Company developing the drug (Active companies)
        indication: Active indications of a drug (e.g. obesity or cancer)
        action: Target specific action (e.g. glucagon)
        phase: Overall Highest development status of drug (any company/indication):
            * S: Suspended
            * DR: Discovery/Preclinical
            * CU: Clinical (unknown phase)
            * C1: Phase 1 Clinical
            * C2: Phase 2 Clinical
            * C3: Phase 3 Clinical
            * PR: Pre-registration
            * R: Registered
            * L: Launched
            * OL: Outlicensed
            * NDR: No Development Reported
            * DX: Discontinued
            * W: Withdrawn
        phase_terminated: Last phase before No Dev Reported or Discontinued statuses
        technology: Technologies used in drug development (e.g. small molecule, biologic)
        drug_name: Name of the drug (e.g. semaglutide)
        country: Country of drug development (e.g. US, EU)
        offset: Starting position in the results (default: 0)
    Returns:
        the list of drugs found in the Cortellis database
    """
    # API credentials
    username = "tr_internal_002"
    password = "4MWGXPU2NYCQS18E"

    # Define the API endpoint
    base_url = "https://api.cortellis.com/api-ws/ws/rs/drugs-v2/drug/search"
    
    # Build the query string if individual parameters are provided
    if query is None:
        query_parts = []
        
        if company:
            query_parts.append(f'companiesPrimary:"{company}"')
        if indication:
            query_parts.append(f'indicationsPrimary:{indication}')
        if action:
            query_parts.append(f'actionsPrimary:{action}')
        if phase:
            query_parts.append(f'phaseHighest::{phase}')
        if phase_terminated:
            query_parts.append(f'phaseTerminated::{phase_terminated}')
        if technology:
            query_parts.append(f'technologies:{technology}')
        if drug_name:
            query_parts.append(f'drugNamesAll:{drug_name}')
        if country:
            query_parts.append(f'LINKED(developmentStatusCountryId:{country})')
        
        if query_parts:
            query = " AND ".join(query_parts)
        else:
            query = "*"  # Default to all results if no parameters provided
    
    # Construct URL with query, offset and hits parameters
    url = f"{base_url}?query={requests.utils.quote(query)}&offset={offset}&filtersEnabled=false&fmt=json&hits=100"
    
    try:
        print("\n=== Debug Information ===")
        print(f"Request URL: {url}")
        
        # Make the request with digest authentication
        response = requests.get(
            url,
            auth=HTTPDigestAuth(username, password)
        )
        
        print(f"Response Status Code: {response.status_code}")
        print("\nResponse Content (first 1000 chars):")
        print(response.text[:1000])
        
        if response.status_code == 200:
            # Return the full JSON response
            return response.json()
        else:
            return f"Search drugs request failed with status code: {response.status_code}"
            
    except requests.exceptions.RequestException as e:
        return f"Connection error: {str(e)}"
    except ValueError as e:
        return f"Failed to parse JSON response: {str(e)}"

@mcp.tool()
def explore_ontology(term: str = None, category: str = None, action: str = None, 
                    indication: str = None, company: str = None, drug_name: str = None,
                    target: str = None, technology: str = None) -> str:
    """
    Explore the ontology or taxonomy terms in the Cortellis database. Use this tool to explore different ways to refer to a term in the Cortellis database.
    
    Args:
        term: Generic search term (used only if no specific category is provided)
        category: Category to search within (action, indication, company, drug_name, target, technology)
        action: Target specific action of the drug (e.g. glucagon, GLP-1)
        indication: Active indications of a drug (e.g. obesity, cancer)
        company: Active companies developing drugs
        drug_name: Drug name to search
        target: Target of the drug
        technology: Technologies used in drug development (e.g. small molecule, biologic)
    
    Returns:
        The list of terms found in the Cortellis database
    
    Examples:
        - Search for "glucagon" actions
        - Search for "obesity" indications
        - Search for companies like "Novo Nordisk"
        - Search for drug names like "semaglutide"
    """
    # API credentials
    username = "tr_internal_002"
    password = "4MWGXPU2NYCQS18E"

    # Base URL
    base_url = "https://api.cortellis.com/api-ws/ws/rs/ontologies-v1/taxonomy"
    
    # Query parameters that will be added to all requests
    params = "?showDuplicates=0&hitSynonyms=1&fmt=json"
    
    # Determine which category and term to use
    search_term = None
    search_category = None
    
    if action:
        search_category = "action"
        search_term = action
    elif indication:
        search_category = "indication"
        search_term = indication
    elif company:
        search_category = "company"
        search_term = company
    elif drug_name:
        search_category = "drug_name"
        search_term = drug_name
    elif target:
        search_category = "target"
        search_term = target
    elif technology:
        search_category = "technology"
        search_term = technology
    elif category and term:
        search_category = category
        search_term = term
    elif term:
        # If only term is provided but no category, default to a general search
        return f"Please specify a category (action, indication, company, drug_name, target, technology) along with your search term."
    else:
        return "Please provide a search term and category."
    
    # Construct the URL
    url = f"{base_url}/{search_category}/search/{search_term}{params}"

    try:
        print("\n=== Debug Information ===")
        print(f"Request URL: {url}")
        
        # Make the request with digest authentication
        response = requests.get(
            url,
            auth=HTTPDigestAuth(username, password),
            headers={'Accept': 'application/json'}  # Request JSON response
        )
        
        print(f"Response Status Code: {response.status_code}")
        print("\nResponse Content (first 1000 chars):")
        print(response.text[:1000])

        if response.status_code == 200:
            # Return the full JSON response
            return response.json()
        else:
            return f"Search ontology request failed with status code: {response.status_code}"
            
    except requests.exceptions.RequestException as e:
        return f"Connection error: {str(e)}"
    except ValueError as e:
        return f"Failed to parse JSON response: {str(e)}"