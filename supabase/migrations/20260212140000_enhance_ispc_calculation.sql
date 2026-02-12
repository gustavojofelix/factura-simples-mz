/*
  # Enhance ISPC Calculation with Progressive Brackets

  1. New Functions
    - `calculate_ispc_split`: Calculates taxes based on progressive brackets:
      - 0 - 1M MT: 3%
      - 1M - 2.5M MT: 4%
      - 2.5M - 4M MT: 5%
      - Above 4M MT: 20%
*/

CREATE OR REPLACE FUNCTION calculate_ispc_split(
  total_sales_period numeric,
  annual_sales_before_period numeric,
  base_rate integer DEFAULT 3
) RETURNS TABLE (
  portion_3pct numeric,
  portion_4pct numeric,
  portion_5pct numeric,
  portion_20pct numeric,
  total_tax numeric
) AS $$
DECLARE
  threshold_1 numeric := 1000000;
  threshold_2 numeric := 2500000;
  threshold_3 numeric := 4000000;
  current_annual numeric := annual_sales_before_period;
  remaining_period numeric := total_sales_period;
  p3 numeric := 0;
  p4 numeric := 0;
  p5 numeric := 0;
  p20 numeric := 0;
  chunk numeric;
BEGIN
  -- Handle the case where base_rate is not for scale activities (e.g. 12% or 15%)
  -- But user specifically asked for 1M -> 3%, then 4%, etc. which implies scale activity.
  -- For non-scale activities (12%, 15%), the requested logic also says 20% above 4M.

  -- Bracket 1 (0 - 1M) @ 3% (or base_rate if not scale)
  IF current_annual < threshold_1 AND remaining_period > 0 THEN
    chunk := LEAST(remaining_period, threshold_1 - current_annual);
    p3 := chunk;
    current_annual := current_annual + chunk;
    remaining_period := remaining_period - chunk;
  END IF;

  -- Bracket 2 (1M - 2.5M) @ 4%
  IF current_annual >= threshold_1 AND current_annual < threshold_2 AND remaining_period > 0 THEN
    chunk := LEAST(remaining_period, threshold_2 - current_annual);
    -- If base_rate was e.g. 12, it stays 12 until 4M? 
    -- The user message says: "calcular os 3% de 1M e 4% apenas do que excedeu-se"
    -- and "assim que exceder de novo no trimestre seguinte ele deve calcluar 4% do valor e 5% sobre o valor excedido"
    -- This applies to the scale.
    p4 := chunk;
    current_annual := current_annual + chunk;
    remaining_period := remaining_period - chunk;
  END IF;

  -- Bracket 3 (2.5M - 4M) @ 5%
  IF current_annual >= threshold_2 AND current_annual < threshold_3 AND remaining_period > 0 THEN
    chunk := LEAST(remaining_period, threshold_3 - current_annual);
    p5 := chunk;
    current_annual := current_annual + chunk;
    remaining_period := remaining_period - chunk;
  END IF;

  -- Bracket 4 (> 4M) @ 20%
  IF remaining_period > 0 THEN
    p20 := remaining_period;
  END IF;

  -- Note: If base_rate is 12 or 15, we override p3, p4, p5 with that rate?
  -- Actually, let's return the portions and let the caller decide the rates or use the logic.
  -- Based on user request, the rates ARE 3, 4, 5 for those specific brackets.
  
  RETURN QUERY SELECT 
    p3, p4, p5, p20,
    (p3 * (CASE WHEN base_rate IN (12, 15) THEN base_rate ELSE 3 END) / 100.0) +
    (p4 * (CASE WHEN base_rate IN (12, 15) THEN base_rate ELSE 4 END) / 100.0) +
    (p5 * (CASE WHEN base_rate IN (12, 15) THEN base_rate ELSE 5 END) / 100.0) +
    (p20 * 20 / 100.0);
END;
$$ LANGUAGE plpgsql;
