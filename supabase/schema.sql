-- Polish Crew CRM schema for Supabase
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz default timezone('utc', now())
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  pkg text,
  size text,
  addons jsonb default '[]'::jsonb,
  vehicles jsonb default '[]'::jsonb,
  total numeric(12,2) default 0,
  status text default 'Quoted',
  notes text,
  created_at timestamptz default timezone('utc', now())
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  date date,
  time text,
  services jsonb default '[]'::jsonb,
  notes text,
  status text default 'New',
  payment_status text default 'unpaid',
  created_at timestamptz default timezone('utc', now())
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete set null,
  customer_id uuid references customers(id) on delete cascade,
  start_time timestamptz,
  end_time timestamptz,
  total numeric(12,2) default 0,
  status text default 'Booked',
  notes text,
  created_at timestamptz default timezone('utc', now())
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  amount numeric(12,2) not null,
  method text,
  type text default 'deposit',
  date date default current_date,
  created_at timestamptz default timezone('utc', now())
);

alter table customers enable row level security;
alter table quotes enable row level security;
alter table appointments enable row level security;
alter table jobs enable row level security;
alter table transactions enable row level security;

create policy "business-read" on customers for select using (auth.role() = 'authenticated');
create policy "business-manage" on customers for all using (auth.role() = 'authenticated');
create policy "business-read" on quotes for select using (auth.role() = 'authenticated');
create policy "business-manage" on quotes for all using (auth.role() = 'authenticated');
create policy "business-read" on appointments for select using (auth.role() = 'authenticated');
create policy "business-manage" on appointments for all using (auth.role() = 'authenticated');
create policy "business-read" on jobs for select using (auth.role() = 'authenticated');
create policy "business-manage" on jobs for all using (auth.role() = 'authenticated');
create policy "business-read" on transactions for select using (auth.role() = 'authenticated');
create policy "business-manage" on transactions for all using (auth.role() = 'authenticated');
