// Os testes de dominio existentes exercitam handlers isoladamente com bancos mock.
// A autorizacao global tem uma suite dedicada em api-authorization.test.js.
process.env.API_AUTH_REQUIRED = process.env.API_AUTH_REQUIRED || 'false';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
