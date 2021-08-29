const endpoint = `${process.env.NEXT_PUBLIC_SHEETS_ENDPOINT}?tabId=${process.env.NEXT_PUBLIC_SHEETS_TAB_ID}&api_key=${process.env.NEXT_PUBLIC_SHEETS_API_KEY}`;

type ContactFormData = {
  name: string;
  email: string;
  message: string;
};

export const submit = (data: ContactFormData) =>
  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify([[data.name, data.email, data.message]]),
  }).then((r) => r.json());
