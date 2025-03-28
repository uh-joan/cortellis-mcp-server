import { McpError } from "@modelcontextprotocol/sdk/types.js";

// Define more specific types
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Removes null and undefined values from an object
 */
export function cleanObject<T extends JsonObject>(obj: T): Partial<T> {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (value !== null && value !== undefined) {
      acc[key as keyof T] = value as T[keyof T];
    }
    return acc;
  }, {} as Partial<T>);
}

/**
 * Deep cleans an object or array of null and undefined values
 */
export function deepCleanObject<T extends JsonValue>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(item => deepCleanObject(item)) as T;
  }
  
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value !== null && value !== undefined) {
        acc[key] = deepCleanObject(value);
      }
      return acc;
    }, {} as JsonObject) as T;
  }
  
  return obj;
}

/**
 * Creates a standardized error object
 */
export function createError(message: string, code: number = 500): McpError {
  return new McpError(code, message);
}

export function pickBySchema(obj: any, schema: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  
  // If the object is an array, process each item
  if (Array.isArray(obj)) {
    return obj.map(item => pickBySchema(item, schema));
  }
  
  const result: Record<string, any> = {};
  for (const key in schema) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const rule = schema[key];
      // If the rule is true, copy the value as-is
      if (rule === true) {
        result[key] = obj[key];
      }
      // If the rule is an object, apply the schema recursively
      else if (typeof rule === 'object' && rule !== null) {
        result[key] = pickBySchema(obj[key], rule);
      }
    }
  }
  return result;
}

export function flattenArraysInObject(input: any, inArray: boolean = false): any {
  if (Array.isArray(input)) {
    // Process each item in the array with inArray=true so that any object
    // inside the array is flattened to a string.
    const flatItems = input.map(item => flattenArraysInObject(item, true));
    return flatItems.join(', ');
  } else if (typeof input === 'object' && input !== null) {
    if (inArray) {
      // When inside an array, ignore the keys and flatten the object's values.
      const values = Object.values(input).map(value => flattenArraysInObject(value, true));
      return values.join(': ');
    } else {
      // When not in an array, process each property recursively.
      const result: Record<string, any> = {};
      for (const key in input) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
          result[key] = flattenArraysInObject(input[key], false);
        }
      }
      return result;
    }
  } else {
    // For primitives, simply return the value.
    return input;
  }
}