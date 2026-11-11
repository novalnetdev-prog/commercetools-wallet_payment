# Novalnet Payment Integration Enabler

The Enabler module provides the frontend integration between commercetools Checkout and Novalnet's secure payment components.

The Enabler acts as the frontend wrapper used by commercetools Checkout to load Novalnet payment methods dynamically based on merchant configuration.

## Features

- Secure payment form rendering
- Credit Card inline form
- 3D Secure support
- Dynamic payment method loading
- Redirect payment initialization
- Secure payment token generation

---

## Responsibilities

The Enabler is responsible for:

- Loading Novalnet frontend libraries.
- Rendering secure payment forms.
- Collecting payment information.
- Generating payment tokens for supported methods.
- Initializing redirect payment flows.
- Communicating with the Processor APIs.

Sensitive payment information is handled entirely by Novalnet's secure components.

---

## Supported Payment UI

The Enabler dynamically initializes payment methods supported by the merchant configuration, including:

- Credit Card
- Direct Debit SEPA
- ACH
- Guaranteed Invoice
- Guaranteed Direct Debit SEPA
- PayPal
- TWINT
- Przelewy24
- EPS
- Bancontact
- Multibanco
- Trustly
- WeChat Pay
- Online Bank Transfer
- PIX
- Boleto
- Bizum
- BANCOMAT Pay
-  Kakao Pay
-   Naver Pay
---

## Frontend Flow

```
Checkout
   │
Enabler
   │
Novalnet JS SDK
   │
Secure Payment Data
   │
Processor
   │
Novalnet API
```

---

## Configuration

The Enabler receives its runtime configuration from the Processor through commercetools Checkout.

This includes:

- available payment methods
- merchant configuration
- localization
- test mode
- 3D Secure settings
- session information
