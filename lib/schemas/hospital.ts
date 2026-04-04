export const HOSPITAL_DDL_PROMPT = `
Generate SQLite DDL for a realistic hospital management database.

Output ONLY CREATE TABLE and DROP TABLE IF EXISTS statements. No INSERT, no data, no comments.

Tables required: departments, doctors, patients, insurance, visits, diagnoses, prescriptions, lab_results

Requirements:
- Use proper SQLite types (INTEGER, TEXT, REAL, NUMERIC)
- Add FOREIGN KEY constraints
- Add CHECK constraints where sensible
- departments: id, name, floor, head_doctor_id (nullable FK to doctors)
- doctors: id, department_id, name, specialization, license_number, years_experience, phone
- patients: id, name, dob, gender, blood_type, phone, email, address, emergency_contact
- insurance: id, patient_id, provider, policy_number, coverage_type, valid_until
- visits: id, patient_id, doctor_id, visit_type (emergency/routine/followup/icu), admitted_at, discharged_at, chief_complaint, notes, cost
- diagnoses: id, visit_id, icd_code, description, severity (mild/moderate/severe/critical), diagnosed_at
- prescriptions: id, visit_id, doctor_id, medication_name, dosage, frequency, duration_days, prescribed_at
- lab_results: id, visit_id, test_name, result_value, unit, reference_range, is_abnormal, tested_at

Start with DROP TABLE IF EXISTS for each table in reverse dependency order.
`
