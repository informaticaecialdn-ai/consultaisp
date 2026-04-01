import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  type Customer, type InsertCustomer,
} from "@shared/schema";

export class CustomersStorage {
  async getCustomersByProvider(providerId: number): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.providerId, providerId));
  }

  async getCustomerByCpfCnpj(cpfCnpj: string): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.cpfCnpj, cpfCnpj));
  }

  async getCustomersByAddressHash(addressHash: string, excludeCpfCnpj?: string): Promise<Customer[]> {
    const results = await db.select().from(customers)
      .where(eq(customers.addressHash, addressHash));
    if (excludeCpfCnpj) {
      const cleanExclude = excludeCpfCnpj.replace(/\D/g, "");
      return results.filter(c => c.cpfCnpj.replace(/\D/g, "") !== cleanExclude);
    }
    return results;
  }

  async getCustomersByExactAddress(address: string, city: string, state: string | null, cep: string | null, excludeCpfCnpj: string): Promise<Customer[]> {
    if (!address || !city) return [];
    const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const normalAddr = n(address);
    const normalCity = n(city);
    const normalState = state ? n(state) : null;
    const normalCep = cep ? cep.replace(/\D/g, "") : null;
    const all = await db.select().from(customers);
    return all.filter(c => {
      if (!c.address || !c.city) return false;
      if (n(c.address) !== normalAddr) return false;
      if (n(c.city) !== normalCity) return false;
      if (normalState && c.state && n(c.state) !== normalState) return false;
      if (normalCep && c.cep) {
        if (c.cep.replace(/\D/g, "") !== normalCep) return false;
      }
      if (c.cpfCnpj.replace(/\D/g, "") === excludeCpfCnpj) return false;
      return true;
    });
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const [created] = await db.insert(customers).values(customer).returning();
    return created;
  }

}
