import { TestBed } from '@angular/core/testing';
import { SupabaseService } from './supabase.service';

// Mock the supabase-js library
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockReturnValue({
    auth: {
      persistSession: true,
    },
    // The client is returning itself
  })
}));

import { createClient } from '@supabase/supabase-js';

describe('SupabaseService', () => {
  let service: SupabaseService;

  beforeEach(() => {
    // Reset mock before each test
    (createClient as jest.Mock).mockClear();
    
    // Provide environment variables mock if needed
    // or just let the real ones trigger the mock
    TestBed.configureTestingModule({});
    service = TestBed.inject(SupabaseService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return the client from getter', () => {
    const client = service.client;
    expect(client).toBeDefined();
  });

  it('should return the auth module from getter', () => {
    const auth = service.auth;
    expect(auth).toBeDefined();
  });

  it('should return the db (client) from getter', () => {
    const db = service.db;
    expect(db).toBeDefined();
    expect(db).toBe(service.client); // db should be the same as client
  });
});
