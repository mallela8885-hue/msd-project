declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_API_URL: string;
    NEXT_PUBLIC_API_BASE_URL: string;
    REACT_APP_API_URL: string;
    NEXT_PUBLIC_SOCKET_SERVER_URL: string;
    NEXT_PUBLIC_WEBSOCKET_URL: string;
    NODE_ENV: 'development' | 'production' | 'test';
    NEXT_PUBLIC_ENV: 'development' | 'production';
    NEXT_PUBLIC_PROMETHEUS_URL: string;
    NEXT_PUBLIC_AUTH_TOKEN_KEY: string;
    NEXT_PUBLIC_REFRESH_TOKEN_KEY: string;
    NEXT_PUBLIC_USER_KEY: string;
  }
}
