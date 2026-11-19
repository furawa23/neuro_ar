using System;
using System.Collections.Generic;

namespace NeuroAR.Core
{
    [Serializable]
    public sealed class NetworkSnapshot
    {
        public double[] Inputs;
        public double[] HiddenSums;
        public double[] HiddenActivations;
        public double OutputSum;
        public double Output;
    }

    [Serializable]
    public sealed class NetworkParameters
    {
        public double[][] InputWeights;
        public double[] HiddenBiases;
        public double[] OutputWeights;
        public double OutputBias;
        public int Epoch;
        public double LearningRate;
    }

    public readonly struct TrainingSample
    {
        public readonly double X1;
        public readonly double X2;
        public readonly double Target;

        public TrainingSample(double x1, double x2, double target)
        {
            X1 = x1;
            X2 = x2;
            Target = target;
        }
    }

    /// <summary>
    /// A deterministic 2-4-1 network for XOR: tanh hidden units, a sigmoid output,
    /// and full-batch gradient descent on mean binary cross-entropy.
    /// All mathematics is independent of Unity and rendering.
    /// </summary>
    public sealed class TinyNetwork
    {
        public const int InputCount = 2;
        public const int HiddenCount = 4;

        private static readonly IReadOnlyList<TrainingSample> samples = Array.AsReadOnly(new[]
        {
            new TrainingSample(0, 0, 0),
            new TrainingSample(0, 1, 1),
            new TrainingSample(1, 0, 1),
            new TrainingSample(1, 1, 0)
        });

        private readonly double[][] inputWeights = new double[HiddenCount][];
        private readonly double[] hiddenBiases = new double[HiddenCount];
        private readonly double[] outputWeights = new double[HiddenCount];
        private double outputBias;
        private double learningRate = 0.6;

        public static IReadOnlyList<TrainingSample> Samples { get { return samples; } }
        public int Epoch { get; private set; }

        public double LearningRate
        {
            get { return learningRate; }
            set
            {
                ValidateFinite(value, nameof(value));
                if (value <= 0) throw new ArgumentOutOfRangeException(nameof(value), "Learning rate must be positive.");
                learningRate = value;
            }
        }

        public TinyNetwork(int seed = 42)
        {
            // Fixed PRNG arithmetic keeps an initial seed identical in Unity and .NET.
            uint state = unchecked((uint)seed);
            for (int h = 0; h < HiddenCount; h++)
            {
                inputWeights[h] = new double[InputCount];
                for (int i = 0; i < InputCount; i++) inputWeights[h][i] = NextSigned(ref state);
                hiddenBiases[h] = NextSigned(ref state) * 0.1;
                outputWeights[h] = NextSigned(ref state) * Math.Sqrt(6.0 / (HiddenCount + 1));
            }
        }

        public NetworkSnapshot Evaluate(double x1, double x2)
        {
            ValidateFinite(x1, nameof(x1));
            ValidateFinite(x2, nameof(x2));
            var snapshot = new NetworkSnapshot
            {
                Inputs = new[] { x1, x2 },
                HiddenSums = new double[HiddenCount],
                HiddenActivations = new double[HiddenCount]
            };
            double sum = outputBias;
            for (int h = 0; h < HiddenCount; h++)
            {
                double z = inputWeights[h][0] * x1 + inputWeights[h][1] * x2 + hiddenBiases[h];
                CheckCalculation(z);
                double activation = Math.Tanh(z);
                snapshot.HiddenSums[h] = z;
                snapshot.HiddenActivations[h] = activation;
                sum += outputWeights[h] * activation;
            }
            CheckCalculation(sum);
            snapshot.OutputSum = sum;
            snapshot.Output = Sigmoid(sum);
            return snapshot;
        }

        public double Loss
        {
            get
            {
                double total = 0;
                for (int i = 0; i < samples.Count; i++)
                {
                    TrainingSample sample = samples[i];
                    double logit = Evaluate(sample.X1, sample.X2).OutputSum;
                    // This stable logit form avoids log(0) for saturated sigmoid outputs.
                    total += Math.Max(logit, 0) - sample.Target * logit + Math.Log(1 + Math.Exp(-Math.Abs(logit)));
                }
                return total / samples.Count;
            }
        }

        public void TrainEpoch()
        {
            if (Epoch == int.MaxValue) throw new InvalidOperationException("Epoch limit reached.");
            var inputGradient = new double[HiddenCount, InputCount];
            var hiddenGradient = new double[HiddenCount];
            var outputGradient = new double[HiddenCount];
            double biasGradient = 0;

            for (int sampleIndex = 0; sampleIndex < samples.Count; sampleIndex++)
            {
                TrainingSample sample = samples[sampleIndex];
                NetworkSnapshot forward = Evaluate(sample.X1, sample.X2);
                double outputDelta = (forward.Output - sample.Target) / samples.Count;
                biasGradient += outputDelta;
                for (int h = 0; h < HiddenCount; h++)
                {
                    double activation = forward.HiddenActivations[h];
                    outputGradient[h] += outputDelta * activation;
                    double hiddenDelta = outputDelta * outputWeights[h] * (1 - activation * activation);
                    hiddenGradient[h] += hiddenDelta;
                    for (int i = 0; i < InputCount; i++) inputGradient[h, i] += hiddenDelta * forward.Inputs[i];
                }
            }

            // Prepare and validate every update before committing any parameter.
            NetworkParameters next = Capture();
            for (int h = 0; h < HiddenCount; h++)
            {
                for (int i = 0; i < InputCount; i++) next.InputWeights[h][i] -= learningRate * inputGradient[h, i];
                next.HiddenBiases[h] -= learningRate * hiddenGradient[h];
                next.OutputWeights[h] -= learningRate * outputGradient[h];
            }
            next.OutputBias -= learningRate * biasGradient;
            next.Epoch++;
            Restore(next);
        }

        public double GetWeight(int layer, int target, int source)
        {
            ValidateWeightIndex(layer, target, source);
            return layer == 1 ? inputWeights[target][source] : outputWeights[source];
        }

        public void SetWeight(int layer, int target, int source, double value)
        {
            ValidateWeightIndex(layer, target, source);
            ValidateFinite(value, nameof(value));
            if (layer == 1) inputWeights[target][source] = value;
            else outputWeights[source] = value;
        }

        public double GetBias(int layer, int target)
        {
            ValidateBiasIndex(layer, target);
            return layer == 1 ? hiddenBiases[target] : outputBias;
        }

        public void SetBias(int layer, int target, double value)
        {
            ValidateBiasIndex(layer, target);
            ValidateFinite(value, nameof(value));
            if (layer == 1) hiddenBiases[target] = value;
            else outputBias = value;
        }

        public NetworkParameters Capture()
        {
            var weights = new double[HiddenCount][];
            for (int h = 0; h < HiddenCount; h++) weights[h] = (double[])inputWeights[h].Clone();
            return new NetworkParameters
            {
                InputWeights = weights,
                HiddenBiases = (double[])hiddenBiases.Clone(),
                OutputWeights = (double[])outputWeights.Clone(),
                OutputBias = outputBias,
                Epoch = Epoch,
                LearningRate = learningRate
            };
        }

        public void Restore(NetworkParameters parameters)
        {
            if (parameters == null) throw new ArgumentNullException(nameof(parameters));
            ValidateArray(parameters.InputWeights, HiddenCount, nameof(parameters.InputWeights));
            ValidateArray(parameters.HiddenBiases, HiddenCount, nameof(parameters.HiddenBiases));
            ValidateArray(parameters.OutputWeights, HiddenCount, nameof(parameters.OutputWeights));
            for (int h = 0; h < HiddenCount; h++)
            {
                ValidateArray(parameters.InputWeights[h], InputCount, nameof(parameters.InputWeights));
                for (int i = 0; i < InputCount; i++) ValidateFinite(parameters.InputWeights[h][i], nameof(parameters.InputWeights));
                ValidateFinite(parameters.HiddenBiases[h], nameof(parameters.HiddenBiases));
                ValidateFinite(parameters.OutputWeights[h], nameof(parameters.OutputWeights));
            }
            ValidateFinite(parameters.OutputBias, nameof(parameters.OutputBias));
            ValidateFinite(parameters.LearningRate, nameof(parameters.LearningRate));
            if (parameters.Epoch < 0) throw new ArgumentOutOfRangeException(nameof(parameters.Epoch));
            if (parameters.LearningRate <= 0) throw new ArgumentOutOfRangeException(nameof(parameters.LearningRate));

            for (int h = 0; h < HiddenCount; h++)
            {
                Array.Copy(parameters.InputWeights[h], inputWeights[h], InputCount);
                hiddenBiases[h] = parameters.HiddenBiases[h];
                outputWeights[h] = parameters.OutputWeights[h];
            }
            outputBias = parameters.OutputBias;
            learningRate = parameters.LearningRate;
            Epoch = parameters.Epoch;
        }

        private static void ValidateWeightIndex(int layer, int target, int source)
        {
            ValidateBiasIndex(layer, target);
            int count = layer == 1 ? InputCount : HiddenCount;
            if (source < 0 || source >= count) throw new ArgumentOutOfRangeException(nameof(source));
        }

        private static void ValidateBiasIndex(int layer, int target)
        {
            if (layer != 1 && layer != 2) throw new ArgumentOutOfRangeException(nameof(layer), "Only hidden (1) and output (2) layers have parameters.");
            if (target < 0 || target >= (layer == 1 ? HiddenCount : 1)) throw new ArgumentOutOfRangeException(nameof(target));
        }

        private static void ValidateArray(Array value, int length, string name)
        {
            if (value == null || value.Length != length) throw new ArgumentException("Unexpected parameter dimensions.", name);
        }

        private static void ValidateFinite(double value, string name)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) throw new ArgumentOutOfRangeException(name, "A finite number is required.");
        }

        private static void CheckCalculation(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) throw new InvalidOperationException("The parameter or input magnitude caused a numerical overflow.");
        }

        private static double Sigmoid(double value)
        {
            if (value >= 0) return 1 / (1 + Math.Exp(-value));
            double exp = Math.Exp(value);
            return exp / (1 + exp);
        }

        private static double NextSigned(ref uint state)
        {
            state = unchecked(1664525u * state + 1013904223u);
            return state / (double)uint.MaxValue * 2 - 1;
        }
    }
}
