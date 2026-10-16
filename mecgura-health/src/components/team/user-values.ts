// Plain (server-safe) values for the user form.
export interface UserFormValues {
  name: string; email: string; phone: string; role: string; grants: string[];
  qualification: string; specialization: string; registrationNumber: string; experienceYears: string; gender: string; bio: string; consultationFee: string;
  employeeRef: string; designation: string;
}
export const EMPTY_USER: UserFormValues = { name: "", email: "", phone: "", role: "RECEPTIONIST", grants: [], qualification: "", specialization: "", registrationNumber: "", experienceYears: "", gender: "", bio: "", consultationFee: "", employeeRef: "", designation: "" };

