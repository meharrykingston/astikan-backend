insert into public.provider_integrations (id, provider_key, provider_type, display_name, status, base_url, environment)
values
  (gen_random_uuid(), 'zego', 'video', 'Zego Cloud', 'active', 'https://rtc-api.zegocloud.com', 'prod'),
  (gen_random_uuid(), 'agora', 'video', 'Agora', 'active', 'https://api.agora.io', 'prod'),
  (gen_random_uuid(), 'grok', 'ai', 'Grok AI', 'active', 'https://api.x.ai/v1', 'prod'),
  (gen_random_uuid(), 'openai', 'ai', 'OpenAI', 'active', 'https://api.openai.com/v1', 'prod'),
  (gen_random_uuid(), 'niramaya', 'lab', 'Niramaya', 'active', 'https://www.niramayahealthcare.com/api', 'prod'),
  (gen_random_uuid(), 'razorpay', 'payments', 'Razorpay', 'active', 'https://api.razorpay.com', 'prod'),
  (gen_random_uuid(), 'tally', 'finance', 'Tally ERP', 'testing', 'https://tally.local', 'prod')
on conflict (provider_key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    base_url = excluded.base_url,
    environment = excluded.environment,
    updated_at = timezone('utc', now());

insert into public.service_credit_pricing (id, service_type, service_catalog_ref, company_id, credits_cost, inr_equivalent, is_active, effective_from)
values
  (gen_random_uuid(), 'teleconsult', 'standard_teleconsult', null, 2500, 250.00, true, timezone('utc', now())),
  (gen_random_uuid(), 'opd', 'standard_opd', null, 4000, 400.00, true, timezone('utc', now())),
  (gen_random_uuid(), 'lab', 'cbc', null, 9990, 999.00, true, timezone('utc', now())),
  (gen_random_uuid(), 'lab', 'hba1c', null, 8500, 850.00, true, timezone('utc', now())),
  (gen_random_uuid(), 'lab', 'thyroid_profile', null, 12000, 1200.00, true, timezone('utc', now())),
  (gen_random_uuid(), 'pharmacy', 'doctor_store_default', null, 1500, 150.00, true, timezone('utc', now())),
  (gen_random_uuid(), 'program', 'fitness_challenge', null, 5000, 500.00, true, timezone('utc', now())),
  (gen_random_uuid(), 'assessment', 'health_assessment', null, 1000, 100.00, true, timezone('utc', now()))
on conflict do nothing;

insert into public.lab_test_catalog (
  id, provider, provider_test_code, name, category, sample_type, tat_hours, base_price_inr,
  default_credit_cost, availability_status, coverage_note, metadata_json
)
values
  (gen_random_uuid(), 'niramaya', 'cbc', 'Complete Blood Count (CBC)', 'Blood Test', 'Blood', 24, 999.00, 9990, 'live', 'Routine hematology panel', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'hba1c', 'HbA1c', 'Diabetes Test', 'Blood', 24, 850.00, 8500, 'live', 'Diabetes control monitoring', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'fbs', 'Fasting Blood Sugar', 'Diabetes Test', 'Blood', 12, 299.00, 2990, 'live', 'Requires fasting', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'ppbs', 'Post Prandial Blood Sugar', 'Diabetes Test', 'Blood', 12, 299.00, 2990, 'live', 'Post meal glucose check', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'thyroid_profile', 'Thyroid Profile', 'Hormone Test', 'Blood', 24, 1200.00, 12000, 'live', 'TSH/T3/T4 panel', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'vitamin_d', 'Vitamin D', 'Vitamin Test', 'Blood', 24, 1499.00, 14990, 'live', 'Bone and immunity marker', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'vitamin_b12', 'Vitamin B12', 'Vitamin Test', 'Blood', 24, 999.00, 9990, 'live', 'Fatigue and neuropathy support', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'lft', 'Liver Function Test', 'Liver Test', 'Blood', 24, 799.00, 7990, 'live', 'Liver enzyme panel', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'kft', 'Kidney Function Test', 'Kidney Test', 'Blood', 24, 899.00, 8990, 'live', 'Renal function panel', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'lipid_profile', 'Lipid Profile', 'Lipid Test', 'Blood', 24, 999.00, 9990, 'live', 'Cardiometabolic screening', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'crp', 'C-Reactive Protein (CRP)', 'Blood Test', 'Blood', 24, 699.00, 6990, 'live', 'Inflammation marker', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'esr', 'ESR', 'Blood Test', 'Blood', 24, 249.00, 2490, 'live', 'Inflammatory screening', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'dengue', 'Dengue NS1 Antigen', 'Blood Test', 'Blood', 24, 1499.00, 14990, 'live', 'Fever workup', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'malaria', 'Malaria Parasite Test', 'Blood Test', 'Blood', 24, 799.00, 7990, 'live', 'Fever workup', '{}'::jsonb),
  (gen_random_uuid(), 'niramaya', 'urine_routine', 'Urine Routine', 'Kidney Test', 'Urine', 24, 199.00, 1990, 'live', 'Routine urine exam', '{}'::jsonb)
on conflict (provider, provider_test_code) do update
set name = excluded.name,
    category = excluded.category,
    sample_type = excluded.sample_type,
    tat_hours = excluded.tat_hours,
    base_price_inr = excluded.base_price_inr,
    default_credit_cost = excluded.default_credit_cost,
    availability_status = excluded.availability_status,
    coverage_note = excluded.coverage_note,
    updated_at = timezone('utc', now());
