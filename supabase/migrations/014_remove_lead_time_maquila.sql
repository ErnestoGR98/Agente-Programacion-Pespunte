-- Remove deprecated lead_time_maquila parameter (now handled by MAQUILA temporal constraint)
DELETE FROM parametros_optimizacion WHERE nombre = 'lead_time_maquila';
