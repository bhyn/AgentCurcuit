// Request bodies are copied verbatim from the CRS MCP (get_personas).
// Do not edit: the sandbox only returns canned data when every field matches.

export type Bureau = "transunion" | "equifax" | "experian";

export const BUREAUS: Record<Bureau, { label: string; path: string }> = {
  transunion: { label: "TransUnion", path: "/transunion/credit-report/standard/tu-prequal-fico9" },
  equifax: { label: "Equifax", path: "/equifax/credit-report/standard/efx-prequal-vantage4" },
  experian: { label: "Experian", path: "/experian/credit-report/standard/exp-prequal-vantage4" },
};

type Address = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  borrowerResidencyType: "Current";
};

export type CreditBody = {
  firstName: string;
  lastName: string;
  ssn: string;
  addresses: Address[];
};

export type Persona = {
  id: string;
  name: string;
  profile: string;
  expectedDecision: "APPROVE" | "REVIEW" | "DECLINE" | "NO_FILE";
  expected: string;
  creditBody: CreditBody;
};

export const PERSONAS: Persona[] = [
  {
    id: "P01",
    name: "MARGARET OKAFOR",
    profile: "Prime",
    expectedDecision: "APPROVE",
    expected: "790 / 790 / 790 clean",
    creditBody: {
      firstName: "MARGARET",
      lastName: "OKAFOR",
      ssn: "666701001",
      addresses: [
        {
          addressLine1: "1420 WILLOW CREEK DR",
          city: "SAN JOSE",
          state: "CA",
          postalCode: "95125",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
  {
    id: "P13",
    name: "KAYLA BRENNAN",
    profile: "Synthetic identity / fraud",
    expectedDecision: "DECLINE",
    expected: "640, thin file",
    creditBody: {
      firstName: "KAYLA",
      lastName: "BRENNAN",
      ssn: "666701013",
      addresses: [
        {
          addressLine1: "9021 KINGSTON PIKE",
          city: "KNOXVILLE",
          state: "TN",
          postalCode: "37923",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
  {
    id: "P14",
    name: "HAROLD PETTIGREW",
    profile: "Deceased indicator",
    expectedDecision: "DECLINE",
    expected: "errorMessages 'deceased' at all three bureaus",
    creditBody: {
      firstName: "HAROLD",
      lastName: "PETTIGREW",
      ssn: "666701014",
      addresses: [
        {
          addressLine1: "310 ELM ST",
          city: "DAYTON",
          state: "OH",
          postalCode: "45402",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
  {
    id: "P15",
    name: "NICOLE FARRAGUT",
    profile: "Security freeze at one bureau",
    expectedDecision: "REVIEW",
    expected: "TU NoFileReturnedCreditFreeze / EFX 740 / EXP 740",
    creditBody: {
      firstName: "NICOLE",
      lastName: "FARRAGUT",
      ssn: "666701015",
      addresses: [
        {
          addressLine1: "7700 NE 72ND AVE",
          city: "PORTLAND",
          state: "OR",
          postalCode: "97218",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
  {
    id: "P17",
    name: "ELENA CASTELLANOS",
    profile: "Bureau divergence",
    expectedDecision: "REVIEW",
    expected: "TU 760 / EFX NoFileReturnedNoHit / EXP 700 with 1 charge-off",
    creditBody: {
      firstName: "ELENA",
      lastName: "CASTELLANOS",
      ssn: "666701017",
      addresses: [
        {
          addressLine1: "4400 N CENTRAL EXPY STE 100",
          city: "DALLAS",
          state: "TX",
          postalCode: "75206",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
  {
    id: "P07",
    name: "MARCUS BELLAMY",
    profile: "Chapter 13 active",
    expectedDecision: "DECLINE",
    expected: "560 x3, Chapter 13 filed 2025",
    creditBody: {
      firstName: "MARCUS",
      lastName: "BELLAMY",
      ssn: "666701007",
      addresses: [
        {
          addressLine1: "1507 PEACHTREE INDUSTRIAL BLVD",
          city: "ATLANTA",
          state: "GA",
          postalCode: "30341",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
  {
    id: "P08",
    name: "PRIYA VENKATESAN",
    profile: "Tax lien and civil judgment",
    expectedDecision: "REVIEW",
    expected: "690 / 690 / 690",
    creditBody: {
      firstName: "PRIYA",
      lastName: "VENKATESAN",
      ssn: "666701008",
      addresses: [
        {
          addressLine1: "3300 N LAKE SHORE DR APT 15C",
          city: "CHICAGO",
          state: "IL",
          postalCode: "60657",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
  {
    id: "P19",
    name: "GRACE NAKAMURA",
    profile: "Small-business owner",
    expectedDecision: "APPROVE",
    expected: "770 / 770 / 770 clean",
    creditBody: {
      firstName: "GRACE",
      lastName: "NAKAMURA",
      ssn: "666701019",
      addresses: [
        {
          addressLine1: "1850 SOLANO AVE",
          city: "BERKELEY",
          state: "CA",
          postalCode: "94707",
          borrowerResidencyType: "Current",
        },
      ],
    },
  },
];

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}

export type PitchPointBody = {
  terms: { term: { person: { firstName: string; lastName: string; ssn: string } }[] };
};

// Public-records search body (PitchPoint BLJ), copied from the CRS MCP persona list.
export function pitchPointBody(p: Persona): PitchPointBody {
  const { firstName, lastName, ssn } = p.creditBody;
  return { terms: { term: [{ person: { firstName, lastName, ssn } }] } };
}
