export const environment = {
  production: true,
  // Domínio raiz: cada conta é servida em <slug>.<rootDomain>.
  rootDomain: "ispcfacil.com",
  // Redirecciona entre <slug>.<rootDomain> após o login. Em dev fica desligado:
  // os browsers não partilham cookies em .localhost, por isso a sessão perdia-se.
  // Desligado até existir DNS wildcard (*.ispcfacil.com) e o domínio wildcard no
  // Netlify: sem isso <slug>.ispcfacil.com não resolve e o utilizador fica bloqueado.
  subdomainRouting: false,
  supabaseUrl: "https://ycpnmwlkfolsaubndznj.supabase.co",
  supabaseKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljcG5td2xrZm9sc2F1Ym5kem5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNzQ1MzQsImV4cCI6MjA4MTY1MDUzNH0.EFqcdmDrTKNweg1cD-cLHZBeSIiRnRPFB9jYtjUMK7U",
};
