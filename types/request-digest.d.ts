declare module 'request-digest' {
  interface DigestResponse {
    statusCode: number;
    headers: { [key: string]: string | string[] };
    body: string;
  }

  interface DigestRequest {
    host: string;
    path: string;
    port: number;
    method: string;
    headers: { [key: string]: string };
  }

  interface DigestClient {
    requestAsync(options: DigestRequest): Promise<DigestResponse>;
  }

  function digest(username: string, password: string): DigestClient;
  export = digest;
} 