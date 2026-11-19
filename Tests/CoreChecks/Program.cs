using System;
using NeuroAR.Core;

internal static class Program
{
    private static int checks;

    private static void Main()
    {
        CheckForwardAndDeterminism();
        CheckGradients();
        CheckSnapshotsAndRestore();
        CheckValidationAndExtremeLogits();
        CheckLearning();
        CheckTrainingHistory();
        Console.WriteLine("PASS: " + checks + " neural-core assertions.");
    }

    private static void CheckForwardAndDeterminism()
    {
        var network = new TinyNetwork();
        var duplicate = new TinyNetwork();
        var result = network.Evaluate(0.4, 0.7);
        double outputSum = network.GetBias(2, 0);
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
        {
            double sum = 0.4 * network.GetWeight(1, h, 0) + 0.7 * network.GetWeight(1, h, 1) + network.GetBias(1, h);
            Near(result.HiddenSums[h], sum, 1e-14, "Hidden weighted sum");
            Near(result.HiddenActivations[h], Math.Tanh(sum), 1e-14, "Hidden tanh");
            Near(network.GetWeight(1, h, 0), duplicate.GetWeight(1, h, 0), 0, "Deterministic seed");
            outputSum += network.GetWeight(2, 0, h) * Math.Tanh(sum);
        }
        Near(result.OutputSum, outputSum, 1e-14, "Output weighted sum");
        Near(result.Output, 1 / (1 + Math.Exp(-outputSum)), 1e-14, "Output sigmoid");
        result.Inputs[0] = 999;
        result.HiddenActivations[0] = 999;
        Near(network.Evaluate(0.4, 0.7).Output, duplicate.Evaluate(0.4, 0.7).Output, 0, "Forward snapshots are detached");
    }

    private static void CheckGradients()
    {
        var network = new TinyNetwork { LearningRate = 0.001 };
        NetworkParameters before = network.Capture();
        const double epsilon = 1e-5;
        double[] numerical = new double[17];
        int k = 0;
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
        {
            for (int i = 0; i < TinyNetwork.InputCount; i++)
            {
                double initial = network.GetWeight(1, h, i);
                network.SetWeight(1, h, i, initial + epsilon);
                double plus = network.Loss;
                network.SetWeight(1, h, i, initial - epsilon);
                double minus = network.Loss;
                network.SetWeight(1, h, i, initial);
                numerical[k++] = (plus - minus) / (2 * epsilon);
            }
        }
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
        {
            double initial = network.GetBias(1, h);
            network.SetBias(1, h, initial + epsilon);
            double plus = network.Loss;
            network.SetBias(1, h, initial - epsilon);
            double minus = network.Loss;
            network.SetBias(1, h, initial);
            numerical[k++] = (plus - minus) / (2 * epsilon);
        }
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
        {
            double initial = network.GetWeight(2, 0, h);
            network.SetWeight(2, 0, h, initial + epsilon);
            double plus = network.Loss;
            network.SetWeight(2, 0, h, initial - epsilon);
            double minus = network.Loss;
            network.SetWeight(2, 0, h, initial);
            numerical[k++] = (plus - minus) / (2 * epsilon);
        }
        double initialBias = network.GetBias(2, 0);
        network.SetBias(2, 0, initialBias + epsilon);
        double plusBias = network.Loss;
        network.SetBias(2, 0, initialBias - epsilon);
        double minusBias = network.Loss;
        network.SetBias(2, 0, initialBias);
        numerical[k] = (plusBias - minusBias) / (2 * epsilon);

        network.TrainEpoch();
        k = 0;
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
            for (int i = 0; i < TinyNetwork.InputCount; i++)
                Near((before.InputWeights[h][i] - network.GetWeight(1, h, i)) / before.LearningRate, numerical[k++], 1e-8, "Input weight gradient");
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
            Near((before.HiddenBiases[h] - network.GetBias(1, h)) / before.LearningRate, numerical[k++], 1e-8, "Hidden bias gradient");
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
            Near((before.OutputWeights[h] - network.GetWeight(2, 0, h)) / before.LearningRate, numerical[k++], 1e-8, "Output weight gradient");
        Near((before.OutputBias - network.GetBias(2, 0)) / before.LearningRate, numerical[k], 1e-8, "Output bias gradient");
        Assert(network.Epoch == 1, "Training increments epoch exactly once");
    }

    private static void CheckSnapshotsAndRestore()
    {
        var network = new TinyNetwork();
        NetworkParameters original = network.Capture();
        double expectedOutput = network.Evaluate(1, 0).Output;
        double originalWeight = network.GetWeight(1, 0, 0);
        NetworkParameters detached = network.Capture();
        detached.InputWeights[0][0] = 123;
        detached.HiddenBiases[0] = 123;
        detached.OutputWeights[0] = 123;
        Near(network.GetWeight(1, 0, 0), originalWeight, 0, "Capture deep-copies parameter arrays");
        for (int i = 0; i < 10; i++) network.TrainEpoch();
        network.Restore(original);
        Near(network.Evaluate(1, 0).Output, expectedOutput, 0, "Restore reproduces output");
        Assert(network.Epoch == 0, "Restore reproduces epoch");
        original.InputWeights[0][0] = 345;
        Near(network.GetWeight(1, 0, 0), originalWeight, 0, "Restore does not retain mutable arrays");
        NetworkParameters invalid = network.Capture();
        invalid.InputWeights[0][0] = 98;
        invalid.OutputWeights[3] = double.NaN;
        Throws<ArgumentOutOfRangeException>(() => network.Restore(invalid), "Invalid restore rejected");
        Near(network.GetWeight(1, 0, 0), originalWeight, 0, "Rejected restore is atomic");
    }

    private static void CheckValidationAndExtremeLogits()
    {
        var network = new TinyNetwork();
        Throws<ArgumentOutOfRangeException>(() => network.Evaluate(double.NaN, 0), "NaN input");
        Throws<ArgumentOutOfRangeException>(() => network.Evaluate(0, double.PositiveInfinity), "Infinite input");
        Throws<ArgumentOutOfRangeException>(() => network.SetWeight(0, 0, 0, 1), "Input layer has no trainable weights");
        Throws<ArgumentOutOfRangeException>(() => network.SetWeight(1, 4, 0, 1), "Hidden target bounds");
        Throws<ArgumentOutOfRangeException>(() => network.GetWeight(1, 0, 2), "Input source bounds");
        Throws<ArgumentOutOfRangeException>(() => network.GetWeight(2, 1, 0), "Output target bounds");
        Throws<ArgumentOutOfRangeException>(() => network.SetBias(1, -1, 1), "Negative target bounds");
        Throws<ArgumentOutOfRangeException>(() => network.SetWeight(2, 0, 0, double.NegativeInfinity), "Nonfinite weight");
        Throws<ArgumentOutOfRangeException>(() => network.LearningRate = 0, "Zero learning rate");
        Throws<ArgumentOutOfRangeException>(() => network.LearningRate = double.NaN, "NaN learning rate");
        Throws<ArgumentNullException>(() => network.Restore(null), "Null parameters");
        NetworkParameters dimensions = network.Capture();
        dimensions.HiddenBiases = new double[3];
        Throws<ArgumentException>(() => network.Restore(dimensions), "Invalid parameter dimensions");
        network.SetBias(2, 0, 1000);
        Assert(network.Evaluate(0, 0).Output == 1 && double.IsFinite(network.Loss), "Stable positive logit and BCE");
        network.SetBias(2, 0, -1000);
        Assert(network.Evaluate(0, 0).Output == 0 && double.IsFinite(network.Loss), "Stable negative logit and BCE");
    }

    private static void CheckLearning()
    {
        var network = new TinyNetwork();
        double initialLoss = network.Loss;
        for (int epoch = 0; epoch < 3000; epoch++) network.TrainEpoch();
        Assert(network.Loss < 0.02 && network.Loss < initialLoss, "XOR BCE converges");
        Assert(network.Epoch == 3000, "Epoch count after training");
        foreach (TrainingSample sample in TinyNetwork.Samples)
        {
            double output = network.Evaluate(sample.X1, sample.X2).Output;
            Assert(sample.Target == 1 ? output > 0.9 : output < 0.1, "XOR prediction confidence");
            Console.WriteLine("XOR " + sample.X1 + ", " + sample.X2 + " -> " + output.ToString("F5", System.Globalization.CultureInfo.InvariantCulture));
        }
        Console.WriteLine("BCE: " + initialLoss.ToString("F5") + " -> " + network.Loss.ToString("F5"));
    }

    private static void CheckTrainingHistory()
    {
        var session = new TrainingSession();
        Assert(session.HistoryCount == 1 && session.HistoryIndex == 0 && session.Network.Epoch == 0, "History begins with untrained state");
        NetworkParameters first = session.Network.Capture();
        float initialLoss = session.Losses[0];
        Assert(session.Step(), "First training step succeeds");
        NetworkParameters ten = session.Network.Capture();
        Assert(session.Network.Epoch == 10 && session.HistoryCount == 2 && session.HistoryIndex == 1, "Step records ten epochs");
        session.Step();
        NetworkParameters twenty = session.Network.Capture();
        Assert(session.HistoryCount == 3 && session.Losses.Count == 3, "Each recorded state has a loss");
        session.Scrub(0);
        AssertParametersEqual(session.Network.Capture(), first, "Scrub restores first state exactly");
        Assert(session.Step(200), "Replay succeeds");
        AssertParametersEqual(session.Network.Capture(), ten, "Replay restores next state without additional epochs");
        Assert(session.HistoryCount == 3 && session.HistoryIndex == 1, "Replay preserves future history");
        session.Scrub(int.MaxValue);
        AssertParametersEqual(session.Network.Capture(), twenty, "High scrub index clamps to last state");
        session.Scrub(int.MinValue);
        AssertParametersEqual(session.Network.Capture(), first, "Negative scrub index clamps to first state");
        session.Scrub(1);
        Throws<ArgumentOutOfRangeException>(() => session.EditWeight(1, 0, 0, double.NaN), "Invalid edit rejected");
        Assert(session.HistoryCount == 3 && session.HistoryIndex == 1, "Rejected edit preserves recorded future");
        session.EditWeight(1, 0, 0, 1.75);
        Assert(session.HistoryCount == 2 && session.Losses.Count == 2 && session.HistoryIndex == 1, "Weight edit discards obsolete future states");
        Near(session.Network.GetWeight(1, 0, 0), 1.75, 0, "Weight edit changes selected parameter");
        NetworkParameters branch = session.Network.Capture();
        Near(session.Losses[1], (float)session.Network.Loss, 0, "Weight edit refreshes recorded loss");
        session.Scrub(0);
        Near(session.Losses[0], initialLoss, 0, "Past loss remains unchanged");
        session.Step();
        AssertParametersEqual(session.Network.Capture(), branch, "Edited state can be replayed exactly");
        session.Step();
        Assert(session.HistoryCount == 3 && session.Network.Epoch == 20, "Stepping from edited branch creates new future");
        session.Scrub(0);
        session.EditBias(1, 2, -0.75);
        Assert(session.HistoryCount == 1 && session.HistoryIndex == 0, "Bias edit also truncates future");
        Near(session.Network.GetBias(1, 2), -0.75, 0, "Bias edit changes selected parameter");
        session.Scrub(0);
        Near(session.Network.GetBias(1, 2), -0.75, 0, "Bias edit is recorded");
        session.Reset();
        Assert(session.HistoryCount == 1 && session.Losses.Count == 1 && session.HistoryIndex == 0, "Reset clears history and losses");
        AssertParametersEqual(session.Network.Capture(), first, "Reset restores deterministic initial network");
        Assert(session.Step(10, 17) && session.Network.Epoch == 10, "Custom epoch cap first step");
        Assert(session.Step(10, 17) && session.Network.Epoch == 17, "Final training step respects exact epoch cap");
        Assert(!session.Step(10, 17) && session.HistoryCount == 3, "Reached cap returns false without duplicate state");
        session.Scrub(0);
        Assert(session.Step(10, 0) && session.Network.Epoch == 10, "Epoch cap does not prevent exact history replay");
        Throws<ArgumentOutOfRangeException>(() => session.Step(0), "Zero epoch step rejected");
        Throws<ArgumentOutOfRangeException>(() => session.Step(10, -1), "Negative epoch cap rejected");
        var lossList = session.Losses as System.Collections.Generic.IList<float>;
        Assert(lossList != null && lossList.IsReadOnly, "Loss history cannot be modified by a consumer");
    }

    private static void AssertParametersEqual(NetworkParameters actual, NetworkParameters expected, string label)
    {
        Assert(actual.Epoch == expected.Epoch && actual.LearningRate == expected.LearningRate && actual.OutputBias == expected.OutputBias, label);
        for (int h = 0; h < TinyNetwork.HiddenCount; h++)
        {
            Near(actual.HiddenBiases[h], expected.HiddenBiases[h], 0, label + " hidden bias");
            Near(actual.OutputWeights[h], expected.OutputWeights[h], 0, label + " output weight");
            for (int i = 0; i < TinyNetwork.InputCount; i++)
                Near(actual.InputWeights[h][i], expected.InputWeights[h][i], 0, label + " input weight");
        }
    }

    private static void Near(double actual, double expected, double tolerance, string label)
    {
        Assert(double.IsFinite(actual) && Math.Abs(actual - expected) <= tolerance, label + ": " + actual + " vs " + expected);
    }

    private static void Assert(bool condition, string label)
    {
        checks++;
        if (!condition) throw new Exception("FAILED: " + label);
    }

    private static void Throws<T>(Action action, string label) where T : Exception
    {
        try { action(); }
        catch (T) { checks++; return; }
        throw new Exception("FAILED: " + label + " did not throw " + typeof(T).Name);
    }
}
