// ===== Site settings =====
window.PARTY_CONFIG = {
  // Supabase: Project Settings → API. Leave blank for local demo mode.
  supabaseUrl: "https://jrnkfxyoeczfrnqebfew.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpybmtmeHlvZWN6ZnJucWViZmV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NTY1MjksImV4cCI6MjEwOTEzMjUyOX0.lkeohKQIezraU_sbgobsljhJMnHenC7LTJdZTcmTwOo",

  // Demo mode only: a starter party so you can try things locally.
  demoParty: {
    name: "Halloween Costume Awards",
    subtitle: "Cast your votes before the clock strikes midnight",
    awards: [
      { name: "Scariest Costume", emoji: "💀" },
      { name: "Funniest Costume", emoji: "🤡" },
      { name: "Most Creative",    emoji: "🎨" },
      { name: "Best Overall",     emoji: "🏆" },
    ],
    guests: [
      { name: "Guest One",   costume: "Vampire count with a velvet cape" },
      { name: "Guest Two",   costume: "Inflatable T-rex" },
      { name: "Guest Three", costume: "Haunted Victorian doll" },
      { name: "Guest Four",  costume: "Ghostbuster with a working proton pack" },
    ],
  },
};
