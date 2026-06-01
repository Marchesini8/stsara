const express = require("express");
const paymentService = require("../services/paymentService");
const orderStore = require("../services/orderStore");
const metaCapiService = require("../services/metaCapiService");

const router = express.Router();

const SUBSCRIPTION_PLANS = {
  "15d": {
    label: "15 Dias",
    price: 19.9,
  },
  "30d": {
    label: "30 Dias",
    price: 62.9,
  },
  "3m": {
    label: "3 Meses",
    price: 75.9,
  },
  "6m": {
    label: "6 Meses",
    price: 87.9,
  },
  "upsell-6m": {
    label: "6 Meses",
    price: 19.9,
  },
};

const ADDON_OFFERS = {
  vip: {
    label: "Vip Exclusivo",
    price: 7.9,
  },
  whatsapp: {
    label: "WhatsApp pessoal",
    price: 26.9,
  },
  ruivinha: {
    label: "Privacy MC MIERLA",
    price: 11.9,
  },
  mel: {
    label: "Privacy Mel Maia",
    price: 9.9,
  },
};

function sanitizePreference(value) {
  return value === "email" ? "email" : "email";
}

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "";
}

function sanitizeAttribution(value = {}) {
  return {
    fbp: value.fbp || "",
    fbc: value.fbc || "",
    external_id: value.external_id || "",
    event_source_url: value.event_source_url || "",
  };
}

function sanitizeTracking(value = {}) {
  return {
    src: value.src || "",
    utm_source: value.utm_source || "",
    utm_medium: value.utm_medium || "",
    utm_campaign: value.utm_campaign || "",
    utm_adset: value.utm_adset || "",
    utm_term: value.utm_term || "",
    utm_content: value.utm_content || "",
    fbclid: value.fbclid || "",
    landing_page: value.landing_page || "",
    referrer: value.referrer || "",
    captured_at: value.captured_at || "",
  };
}

function getSelectedPlan(planId) {
  return SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS["15d"];
}

function getSelectedAddons(addons = []) {
  if (!Array.isArray(addons)) return [];

  return addons
    .map((addonId) => ADDON_OFFERS[addonId] && { id: addonId, ...ADDON_OFFERS[addonId] })
    .filter(Boolean);
}

router.post("/checkout", async (req, res) => {
  try {
    const { customer, deliveryPreference, planId } = req.body;
    const attribution = sanitizeAttribution(req.body.attribution);
    const tracking = sanitizeTracking(req.body.tracking);

    if (!customer?.name || !customer?.email) {
      return res.status(400).json({
        error: "Informe nome e e-mail para gerar o Pix.",
      });
    }

    const normalizedCustomer = {
      ...customer,
      phone: customer.phone || process.env.DEFAULT_PHONE_NUMBER || "21999999999",
    };

    const selectedPlan = getSelectedPlan(planId);
    const productName = `${process.env.PRODUCT_NAME || "Acesso Premium MC Mirela"} - ${selectedPlan.label}`;
    const item = {
      title: productName,
      price: selectedPlan.price,
      quantity: 1,
      planId: planId || "15d",
    };
    const selectedAddons = getSelectedAddons(req.body.addons);
    const addonItems = selectedAddons.map((addon) => ({
      title: addon.label,
      price: addon.price,
      quantity: 1,
      addonId: addon.id,
    }));
    const items = [item, ...addonItems];

    const payment = await paymentService.createPixPayment({
      items,
      customer: normalizedCustomer,
      delivery: {},
      tracking,
    });

    const order = orderStore.createOrder({
      customer: normalizedCustomer,
      deliveryPreference: sanitizePreference(deliveryPreference),
      item: {
        ...item,
        addons: selectedAddons,
        total: items.reduce((sum, currentItem) => sum + Number(currentItem.price || 0), 0),
      },
      transactionHash: payment.transaction_hash,
      pixCode: payment.pix_code,
      trackingAttribution: tracking,
      metaAttribution: {
        ...attribution,
        external_id: attribution.external_id || metaCapiService.createExternalId(normalizedCustomer),
        client_ip_address: getIp(req),
        client_user_agent: req.headers["user-agent"] || "",
      },
    });

    return res.json({
      ...payment,
      order_id: order.id,
      delivery_preference: order.deliveryPreference,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error.message);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Erro ao criar pagamento.",
    });
  }
});

router.get("/status/:transactionHash", (req, res) => {
  try {
    const payment = paymentService.getPaymentStatus(req.params.transactionHash);

    if (!payment) {
      return res.json({
        transactionHash: req.params.transactionHash,
        status: "pending",
        isPaid: false,
      });
    }

    return res.json(payment);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Erro ao consultar pagamento.",
    });
  }
});

module.exports = router;
