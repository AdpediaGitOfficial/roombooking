import type { Field } from "@/components/forms/action-form";

export const staffFields: Field[] = [
  { name: "firstName", label: "First name", required: true },
  { name: "lastName", label: "Last name", required: true },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "gender", label: "Gender", type: "select", options: [{ value: "ANY", label: "Not stated" }, { value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }] },
  { name: "department", label: "Department" },
  { name: "company", label: "Company / contractor" },
  { name: "grade", label: "Grade" },
  { name: "designation", label: "Designation" },
  { name: "idType", label: "ID type", placeholder: "Passport, Emirates ID…" },
  { name: "idNumber", label: "ID number" },
  { name: "nationality", label: "Nationality" },
  { name: "joiningDate", label: "Joining date", type: "date" },
];

