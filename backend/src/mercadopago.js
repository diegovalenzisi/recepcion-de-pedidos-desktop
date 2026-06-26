const MERCADOPAGO_API_URL = 'https://api.mercadopago.com/v1/payments';

const authHeaders = () => ({
  Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
});

export const fetchPaymentDetails = async (paymentId) => {
  const response = await fetch(`${MERCADOPAGO_API_URL}/${paymentId}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Mercado Pago respondió ${response.status} al consultar el pago ${paymentId}`);
  }

  return response.json();
};

export const searchPayments = async ({ beginDate, endDate, offset = 0, limit = 50 }) => {
  const params = new URLSearchParams({
    sort: 'date_created',
    criteria: 'asc',
    range: 'date_created',
    begin_date: beginDate,
    end_date: endDate,
    offset: String(offset),
    limit: String(limit),
  });

  const response = await fetch(`${MERCADOPAGO_API_URL}/search?${params.toString()}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Mercado Pago respondió ${response.status} al buscar movimientos`);
  }

  return response.json();
};

const joinName = (first, last) => [first, last].filter(Boolean).join(' ').trim() || null;

export const buildClienteName = (payment) => {
  const payer = payment?.payer;

  const payerName = joinName(payer?.first_name, payer?.last_name);
  if (payerName) return payerName;

  const additionalPayer = payment?.additional_info?.payer;
  const additionalName = joinName(additionalPayer?.first_name, additionalPayer?.last_name);
  if (additionalName) return additionalName;

  const identification = payer?.identification;
  const identificationName = joinName(identification?.first_name, identification?.last_name) || identification?.name;
  if (identificationName) return identificationName;

  const bankInfoPayer = payment?.point_of_interaction?.transaction_data?.bank_info?.payer;
  const bankInfoName =
    bankInfoPayer?.long_name ||
    bankInfoPayer?.name ||
    joinName(bankInfoPayer?.first_name, bankInfoPayer?.last_name);
  if (bankInfoName) return bankInfoName;

  const cardholderName = payment?.card?.cardholder?.name || payment?.additional_info?.cardholder?.name;
  if (cardholderName?.trim()) return cardholderName.trim();

  return null;
};

const SENSITIVE_KEY_PATTERN = /token|secret|password|api_key|client_secret/i;

export const redactSensitiveFields = (value) => {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveFields(val),
      ])
    );
  }

  return value;
};
