// Testi dell'interfaccia in italiano. Nessuna stringa visibile va scritta fuori da qui.
export const it = {
  shop: {
    // Segnaposto: nome reale da definire (SPEC §13.8).
    name: "Barber Shop",
  },
  meta: {
    description: "Prenota il tuo appuntamento dal telefono.",
  },
  home: {
    comingSoon: "Prenotazioni online in arrivo.",
  },
  nav: {
    login: "Accedi",
    profile: "Profilo",
    staffArea: "Area staff",
  },
  auth: {
    logout: "Esci",
    customerLogin: {
      title: "Accedi con la tua email",
      intro: "Ti mandiamo un link per entrare, senza password.",
      emailLabel: "Email",
      submit: "Invia il link di accesso",
      // Volutamente neutro: non deve dire se l'indirizzo è già registrato.
      linkSent: "Controlla la posta: se l'indirizzo è corretto riceverai a breve un link per entrare.",
      invalidEmail: "Inserisci un indirizzo email valido.",
      invalidLink: "Il link non è valido o è scaduto. Richiedine uno nuovo.",
    },
    confirmLink: {
      title: "Conferma l'accesso",
      intro: "Tocca il pulsante per entrare.",
      submit: "Accedi",
    },
    staffLogin: {
      title: "Accesso staff",
      emailLabel: "Email",
      passwordLabel: "Password",
      submit: "Entra",
      invalidCredentials: "Credenziali non valide",
      accountDisabled: "Account disabilitato",
    },
    completeProfile: {
      title: "Completa il tuo profilo",
      intro: "Ci servono pochi dati per poterti contattare in caso di necessità.",
      fullNameLabel: "Nome e cognome",
      phoneLabel: "Telefono",
      privacyConsentLabel: "Ho letto l'informativa privacy e acconsento al trattamento dei miei dati",
      marketingConsentLabel: "Voglio ricevere offerte e novità (facoltativo)",
      submit: "Salva e continua",
      invalid: "Controlla i dati: nome, telefono valido e consenso privacy sono obbligatori.",
      error: "Non è stato possibile salvare. Riprova tra poco.",
    },
  },
  profile: {
    title: "Il tuo profilo",
    comingSoon: "La gestione del profilo è in arrivo.",
  },
  admin: {
    title: "Area staff",
    comingSoon: "Sezione in arrivo.",
    nav: {
      label: "Menu staff",
      calendar: "Calendario",
      services: "Servizi",
      barbers: "Barbieri",
      closures: "Chiusure",
      customers: "Clienti",
      settings: "Impostazioni",
      stats: "Statistiche",
    },
  },
} as const;
