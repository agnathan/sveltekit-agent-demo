import { tool } from 'ai';
import { z } from 'zod';

const calculatorInputSchema = z.object({
	expression: z.string().describe('A math expression to evaluate, e.g. "(2 + 3) * 4"')
});

const unitConverterInputSchema = z.object({
	value: z.number().describe('The numeric value to convert'),
	from: z
		.enum(['miles', 'km', 'lbs', 'kg', 'fahrenheit', 'celsius'])
		.describe('The source unit'),
	to: z.enum(['miles', 'km', 'lbs', 'kg', 'fahrenheit', 'celsius']).describe('The target unit')
});

export function createUtilityTools() {
	const calculator = tool({
		description:
			'Evaluate a mathematical expression and return the result. Supports +, -, *, /, parentheses, and exponents (**).',
		inputSchema: calculatorInputSchema,
		execute: async ({ expression }) => {
			try {
				const sanitized = expression.replace(/[^0-9+\-*/().^ ]/g, '');
				const withPow = sanitized.replace(/\^/g, '**');
				const result = new Function(`return (${withPow})`)();
				return { expression, result: Number(result) };
			} catch {
				return { expression, error: 'Could not evaluate the expression.' };
			}
		}
	});

	const unitConverter = tool({
		description: 'Convert a value between common units (miles/km, lbs/kg, °F/°C).',
		inputSchema: unitConverterInputSchema,
		execute: async ({ value, from, to }) => {
			const conversions: Record<string, (v: number) => number> = {
				'miles->km': (v) => v * 1.60934,
				'km->miles': (v) => v / 1.60934,
				'lbs->kg': (v) => v * 0.453592,
				'kg->lbs': (v) => v / 0.453592,
				'fahrenheit->celsius': (v) => ((v - 32) * 5) / 9,
				'celsius->fahrenheit': (v) => (v * 9) / 5 + 32
			};

			const key = `${from}->${to}`;
			const fn = conversions[key];

			if (!fn) {
				return { error: `Cannot convert from ${from} to ${to}.` };
			}

			return {
				original: `${value} ${from}`,
				converted: `${parseFloat(fn(value).toFixed(4))} ${to}`
			};
		}
	});

	return {
		calculator,
		unitConverter
	};
}
