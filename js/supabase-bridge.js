import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const defaultConfig = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  stripePriceId: '',
  stripeFunction: 'create-stripe-checkout',
  notificationsFunction: 'send-booking-confirmation',
  depositAmount: 50,
};

function readConfig() {
  let config = { ...defaultConfig };
  if (typeof window !== 'undefined' && window.PC_CONFIG) {
    config = { ...config, ...window.PC_CONFIG };
  }
  const script = document.getElementById('pc-config');
  if (script) {
    try {
      const parsed = JSON.parse(script.textContent || '{}');
      config = { ...config, ...parsed };
    } catch (err) {
      console.warn('Invalid pc-config JSON', err);
    }
  }
  return config;
}

function safeParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

class SupabaseBridge {
  constructor() {
    this.config = readConfig();
    this.queueKey = 'pc-sync-queue';
    this.localState = null;
    this.client = null;
    this.initialised = false;
    this.listeners = new Set();
    this._initClient();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.flushQueue());
    }
  }

  _initClient() {
    if (this.config.supabaseUrl && this.config.supabaseAnonKey) {
      try {
        this.client = createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
          auth: {
            persistSession: true,
            storageKey: 'pcwa-supabase-auth',
          },
          global: {
            headers: {
              'x-pcwa-client': 'polish-crew-crm',
            },
          },
        });
      } catch (err) {
        console.warn('Failed to initialise Supabase client', err);
        this.client = null;
      }
    }
  }

  on(event, callback) {
    if (!callback) return () => {};
    const entry = { event, callback };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  emit(event, payload) {
    this.listeners.forEach((listener) => {
      if (listener.event === event) {
        try {
          listener.callback(payload);
        } catch (err) {
          console.error('SupabaseBridge listener error', err);
        }
      }
    });
  }

  isReady() {
    return !!this.client;
  }

  setLocalState(state) {
    this.localState = state;
  }

  async bootstrap(state) {
    this.setLocalState(state);
    if (!this.isReady()) {
      return { synced: false, reason: 'not-configured' };
    }
    try {
      const payload = await this.fetchAll();
      this.mergeRemote(payload);
      this.initialised = true;
      this.emit('sync:complete', payload);
      return { synced: true };
    } catch (err) {
      console.warn('Supabase bootstrap failed', err);
      return { synced: false, reason: err.message };
    }
  }

  async fetchAll() {
    const tables = ['customers', 'quotes', 'jobs', 'appointments', 'transactions'];
    const result = {};
    for (const table of tables) {
      const { data, error } = await this.client.from(table).select('*');
      if (error) throw error;
      result[table] = Array.isArray(data) ? data : [];
    }
    return result;
  }

  mergeRemote(remote) {
    if (!this.localState) return;
    const state = this.localState;
    state.clients = Array.isArray(state.clients) ? state.clients : [];
    const clientsById = new Map(state.clients.map((client) => [client.id, client]));
    (remote.customers || []).forEach((customer) => {
      if (!customer?.id) return;
      const existing = clientsById.get(customer.id);
      if (existing) {
        existing.name = customer.name || existing.name;
        existing.phone = customer.phone || existing.phone;
        existing.email = customer.email || existing.email || '';
        if (customer.notes) existing.notes = customer.notes;
      } else {
        const fresh = {
          id: customer.id,
          name: customer.name || 'Client',
          phone: customer.phone || '',
          email: customer.email || '',
          notes: customer.notes || '',
          discount: { type: 'none', value: 0 },
          vehicles: [],
        };
        state.clients.push(fresh);
        clientsById.set(customer.id, fresh);
      }
    });
    state.clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    state.jobs = Array.isArray(state.jobs) ? state.jobs : [];
    const jobsByRemote = new Map();
    state.jobs.forEach((job) => {
      if (job.remote?.jobId) jobsByRemote.set(`job:${job.remote.jobId}`, job);
      if (job.remote?.quoteId) jobsByRemote.set(`quote:${job.remote.quoteId}`, job);
      if (job.remote?.appointmentId) jobsByRemote.set(`appt:${job.remote.appointmentId}`, job);
      if (job.id) jobsByRemote.set(`local:${job.id}`, job);
    });

    const ensureRemoteRef = (job) => {
      if (!job.remote) job.remote = {};
      return job.remote;
    };

    const upsertJob = (key, updater, fallbackId = null) => {
      let existing = jobsByRemote.get(key);
      if (!existing && fallbackId) {
        existing = jobsByRemote.get(`local:${fallbackId}`);
      }
      if (existing) {
        updater(existing);
        return existing;
      }
      const created = this.createBlankJob();
      updater(created);
      state.jobs.push(created);
      jobsByRemote.set(key, created);
      return created;
    };

    (remote.quotes || []).forEach((quote) => {
      if (!quote?.id) return;
      upsertJob(`quote:${quote.id}`, (job) => {
        const remoteRef = ensureRemoteRef(job);
        remoteRef.quoteId = quote.id;
        job.id = job.id || crypto.randomUUID?.() || `remote-${quote.id}`;
        job.clientId = quote.customer_id || job.clientId;
        const quoteStatus = (quote.status || 'Quoted');
        job.status = quoteStatus === 'Won' ? 'Booked' : quoteStatus;
        job.pkg = quote.pkg || job.pkg;
        job.size = quote.size || job.size;
        job.notes = quote.notes || job.notes;
        job.createdAt = quote.created_at || job.createdAt;
        job.vehicles = this.deserializeVehicles(quote);
        job.services = App?.createServicesFromVehicles ? App.createServicesFromVehicles(job) : job.services;
        job.remoteTotal = quote.total || job.remoteTotal || 0;
      }, quote.id);
    });

    (remote.appointments || []).forEach((appointment) => {
      if (!appointment?.id) return;
      upsertJob(`appt:${appointment.id}`, (job) => {
        const remoteRef = ensureRemoteRef(job);
        remoteRef.appointmentId = appointment.id;
        job.id = job.id || crypto.randomUUID?.() || `appt-${appointment.id}`;
        job.clientId = appointment.customer_id || job.clientId;
        job.status = job.status && job.status !== 'Quoted' ? job.status : 'New';
        job.notes = appointment.notes || job.notes;
        job.schedule = job.schedule || {};
        if (appointment.date) job.schedule.date = appointment.date;
        if (appointment.time) job.schedule.start = appointment.time;
        job.services = this.deserializeServices(appointment.services) || job.services;
        job.remoteTotal = job.remoteTotal || appointment.total || 0;
      }, appointment.id);
    });

    (remote.jobs || []).forEach((srvJob) => {
      if (!srvJob?.id) return;
      upsertJob(`job:${srvJob.id}`, (job) => {
        const remoteRef = ensureRemoteRef(job);
        remoteRef.jobId = srvJob.id;
        if (srvJob.quote_id) remoteRef.quoteId = srvJob.quote_id;
        job.id = job.id || crypto.randomUUID?.() || `job-${srvJob.id}`;
        job.clientId = srvJob.customer_id || job.clientId;
        job.status = srvJob.status || job.status || 'Booked';
        job.notes = srvJob.notes || job.notes;
        job.schedule = job.schedule || {};
        if (srvJob.start_time) job.schedule.date = srvJob.start_time.slice(0, 10);
        if (srvJob.start_time) job.schedule.start = srvJob.start_time.slice(11, 16);
        if (srvJob.end_time) job.schedule.end = srvJob.end_time.slice(11, 16);
        job.remoteTotal = srvJob.total || job.remoteTotal || 0;
      }, srvJob.id);
    });

    const transactionsById = new Map();
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    state.transactions.forEach((tx) => {
      if (tx.remote?.transactionId) transactionsById.set(tx.remote.transactionId, tx);
    });

    (remote.transactions || []).forEach((tx) => {
      if (!tx?.id) return;
      let record = transactionsById.get(tx.id);
      if (!record) {
        record = {
          id: crypto.randomUUID?.() || `tx-${tx.id}`,
          type: tx.type === 'deposit' || tx.type === 'balance' ? 'Income' : 'Expense',
          payment: tx.method || 'Card',
          amount: Number(tx.amount || 0),
          date: tx.date || '',
          notes: '',
          clientId: tx.customer_id || null,
          jobId: tx.job_id || null,
          remote: { transactionId: tx.id },
        };
        state.transactions.push(record);
        transactionsById.set(tx.id, record);
      } else {
        record.amount = Number(tx.amount || record.amount || 0);
        record.payment = tx.method || record.payment;
        record.date = tx.date || record.date;
        record.clientId = tx.customer_id || record.clientId;
        record.jobId = tx.job_id || record.jobId;
      }
    });
  }

  createBlankJob() {
    return {
      id: crypto.randomUUID?.() || `job-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
      clientId: '',
      pkg: '',
      size: '',
      vehicles: [],
      services: [],
      payments: [],
      status: 'Quoted',
      schedule: { date: '', start: '', end: '', durationMinutes: null },
      discType: 'none',
      discValue: 0,
      discScope: 'job',
      notes: '',
      extraCharges: [],
      timers: {
        overall: { id: 'overall', label: 'Overall Timer', elapsed: 0, runningSince: null },
        setup: { id: 'setup', label: 'Setup / Prep', elapsed: 0, runningSince: null },
        base: { id: 'base', label: 'Base Services', elapsed: 0, runningSince: null },
        addons: { id: 'addons', label: 'Add-ons / Finishing', elapsed: 0, runningSince: null },
      },
      checklist: null,
      remote: {},
    };
  }

  deserializeVehicles(quote) {
    const parsedAddons = safeParse(quote.addons) || [];
    const basePkg = quote.pkg || '';
    const size = quote.size || '';
    const vehicles = Array.isArray(quote.vehicles) ? quote.vehicles : safeParse(quote.vehicles) || [];
    if (vehicles.length) {
      return vehicles.map((vehicle, index) => ({
        id: vehicle.id || `vehicle-${index}`,
        label: vehicle.label || '',
        pkg: vehicle.pkg || basePkg,
        size: vehicle.size || size,
        base: Number(vehicle.base || 0),
        addons: Array.isArray(vehicle.addons)
          ? vehicle.addons.map((addon) => ({
              name: addon.name,
              price: Number(addon.price || 0),
              included: !!addon.included,
            }))
          : [],
      }));
    }
    return [
      {
        id: `vehicle-0`,
        label: '',
        pkg: basePkg,
        size,
        base: Number(quote.total || 0),
        addons: parsedAddons.map((addon) => ({
          name: addon.name || addon,
          price: Number(addon.price || 0),
          included: !!addon.included,
        })),
      },
    ];
  }

  deserializeServices(servicesValue) {
    const services = safeParse(servicesValue);
    if (!Array.isArray(services)) return null;
    return services.map((service) => ({
      id: crypto.randomUUID?.() || `svc-${Math.random().toString(36).slice(2)}`,
      type: service.type || 'service',
      name: service.name || 'Service',
      price: Number(service.price || 0),
      included: !!service.included,
    }));
  }

  queueAction(action) {
    const queue = this.readQueue();
    queue.push({ ...action, queuedAt: Date.now() });
    this.writeQueue(queue);
    this.flushQueue();
  }

  readQueue() {
    try {
      const raw = localStorage.getItem(this.queueKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('Failed to read sync queue', err);
      return [];
    }
  }

  writeQueue(queue) {
    try {
      localStorage.setItem(this.queueKey, JSON.stringify(queue));
    } catch (err) {
      console.warn('Failed to write sync queue', err);
    }
  }

  async flushQueue() {
    if (!this.isReady()) return;
    const queue = this.readQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const action of queue) {
      try {
        if (action.type === 'upsert' && action.table && action.payload) {
          const { error } = await this.client.from(action.table).upsert(action.payload);
          if (error) throw error;
        } else if (action.type === 'invoke' && action.functionName) {
          const { error } = await this.client.functions.invoke(action.functionName, {
            body: action.payload || {},
          });
          if (error) throw error;
        }
      } catch (err) {
        console.warn('Failed to flush sync action', action, err);
        remaining.push(action);
      }
    }
    this.writeQueue(remaining);
  }

  scheduleUpsert(table, payload) {
    if (!table || !payload) return;
    this.queueAction({ type: 'upsert', table, payload });
  }

  scheduleFunction(functionName, payload) {
    if (!functionName) return;
    this.queueAction({ type: 'invoke', functionName, payload });
  }

  async createBooking({ customer, appointment, charge }) {
    if (!this.isReady()) {
      this.queueAction({ type: 'invoke', functionName: this.config.notificationsFunction, payload: { customer, appointment, charge } });
      this.queueAction({ type: 'upsert', table: 'appointments', payload: appointment });
      return { queued: true };
    }
    const { data: customerData, error: customerError } = await this.client
      .from('customers')
      .upsert(customer)
      .select()
      .single();
    if (customerError) throw customerError;
    const appointmentPayload = { ...appointment, customer_id: customerData.id };
    const { data: appointmentData, error: appointmentError } = await this.client
      .from('appointments')
      .insert(appointmentPayload)
      .select()
      .single();
    if (appointmentError) throw appointmentError;
    if (charge && this.config.notificationsFunction) {
      await this.client.functions.invoke(this.config.notificationsFunction, {
        body: { customer: customerData, appointment: appointmentData, charge },
      });
    }
    this.emit('booking:created', { customer: customerData, appointment: appointmentData, charge });
    return { customer: customerData, appointment: appointmentData };
  }

  async createStripeCheckout(payload) {
    if (!this.isReady()) {
      this.queueAction({ type: 'invoke', functionName: this.config.stripeFunction, payload });
      return { queued: true };
    }
    const { data, error } = await this.client.functions.invoke(this.config.stripeFunction, {
      body: payload,
    });
    if (error) throw error;
    return data;
  }
}

window.SupabaseBridge = new SupabaseBridge();

